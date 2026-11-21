import type { Logger } from '@hexok/logger';
import {
  type StandardSchemaV1,
  UseCase,
  validate,
  validationError,
} from 'hexok';

/**
 * Context for calls made before anyone is known, such as login. It has no
 * actor: this is not a Lattice family, so Lattice's actor stays required.
 */
export type AuthCtx = { readonly logger: Logger };

/** Each auth use case declares the schema of its `execute` input. */
export type AuthSpec = { readonly input: StandardSchemaV1 };

/** Rejects input the declared schema does not accept, before `execute`. */
function validInput({
  spec,
  token,
  input,
}: {
  spec: AuthSpec;
  token: string;
  input: unknown;
}): void {
  const parsed = validate(spec.input, input);
  if (!parsed.ok) {
    throw validationError(`${token} input is invalid`, parsed.issues);
  }
}

/** The family of auth use cases: input checked, no actor. */
export const AuthUseCase = UseCase.context<AuthCtx, AuthSpec>().guard(
  validInput,
);
