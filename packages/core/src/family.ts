import { type StandardSchemaV1, UseCase } from 'hexok';
import type { z } from 'zod';
import type { AnyCollection } from './collection.js';

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

/** Builds the app's one use case family on hexok `UseCase.context`. */
export function family<A extends StandardSchemaV1>(options: {
  actor: A;
}): Family<StandardSchemaV1.InferOutput<A>> {
  void options;
  return UseCase.context<
    FamilyContext<StandardSchemaV1.InferOutput<A>>,
    FamilySpec
  >();
}
