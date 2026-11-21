import { type StandardSchemaV1, UseCase, validate } from 'hexok';
import type { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { invalid, LatticeError } from './errors.js';

/** The statics every use case in a Lattice family declares. */
export type FamilySpec = {
  readonly collection: AnyCollection;
  readonly input?: z.ZodType;
  readonly output?: z.ZodType;
};

/** The per-call context of a Lattice family. */
export type FamilyContext<Actor> = { readonly actor: Actor };

/** A Lattice family: a hexok `UseCase.context` factory. */
export type Family<Actor> = UseCase.ContextFactory<
  FamilyContext<Actor>,
  FamilySpec
>;

/**
 * Builds the app's one use case family on hexok `UseCase.context`. Before
 * any member's `execute` runs, the actor must parse against `actor` and the
 * input against the member's `input` static.
 */
export function family<A extends StandardSchemaV1>(options: {
  actor: A;
}): Family<StandardSchemaV1.InferOutput<A>> {
  return UseCase.context<
    FamilyContext<StandardSchemaV1.InferOutput<A>>,
    FamilySpec
  >()
    .guard(({ ctx }) => {
      // The issues describe the caller's credentials, so they stay out of
      // the error.
      if (!validate(options.actor, ctx.actor).ok) {
        throw LatticeError.UNAUTHORIZED();
      }
    })
    .guard(({ spec, input }) => {
      // hexok hands execute the caller's input, not the parsed value. So a
      // method's input schema uses no defaults or transforms; a generated use
      // case parses its own input inside execute to strip unknown keys and
      // apply defaults.
      if (spec.input === undefined) return;
      const result = spec.input.safeParse(input);
      if (!result.success) throw invalid(result.error.issues);
    });
}
