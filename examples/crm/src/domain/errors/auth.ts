import { Errors } from 'hexok';

/**
 * Login's one refusal. A wrong password, an unknown email and a locked
 * email all throw it, so a caller cannot tell them apart. Why is logged.
 */
export class LoginError extends Errors('login', {
  Refused: { message: 'The credentials are not valid' },
}) {}

/** Setting a password that the policy refuses. */
export class CredentialError extends Errors('credentials', {
  PasswordTooShort: {
    message: 'A password needs at least 12 characters',
  },
}) {}
