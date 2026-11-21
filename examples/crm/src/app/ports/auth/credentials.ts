import { Port, type Result } from 'hexok';

/** Why a login's credentials proved nothing. For logs only. */
export type CredentialRefusal = 'unknown' | 'wrong-password';

/** The shortest password `set` accepts. */
export const minPasswordLength = 12;

/**
 * The crm's passwords. Only the adapter sees a hash: `verify` answers with
 * the user or a refusal, and `set` takes the plain password. Emails are
 * trimmed and lowercased, so they match however they were typed.
 */
export abstract class Credentials extends Port('Credentials') {
  /**
   * The user whose email and password these are. An unknown email costs
   * the same hash as a known one, so timing does not tell them apart.
   */
  abstract verify(
    email: string,
    password: string,
  ): Promise<Result<{ readonly userId: string }, CredentialRefusal>>;

  /**
   * Sets the user's email and password, creating the credential when
   * missing. Throws `CredentialError.PasswordTooShort` under
   * {@link minPasswordLength} characters.
   */
  abstract set(
    user: { readonly userId: string; readonly email: string },
    password: string,
  ): Promise<void>;
}
