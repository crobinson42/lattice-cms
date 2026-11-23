import { isPFError } from '@ts-pf/protocol';
import { type FormEvent, useState } from 'react';
import { authClient } from './auth.js';

/** Email and password, through `/auth` login. */
export function SignIn({
  onSignedIn,
}: {
  readonly onSignedIn: (token: string) => void;
}) {
  const [error, setError] = useState<string | undefined>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { token } = await authClient(fetch).login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      onSignedIn(token);
    } catch (refused) {
      setError(
        isPFError(refused) && refused.code === 'UNAUTHORIZED'
          ? 'The email or password is wrong.'
          : 'Signing in failed. Try again.',
      );
    }
  };
  return (
    <form
      className="sign-in"
      aria-label="Sign in"
      onSubmit={(event) => void submit(event)}
    >
      <h1>Sign in</h1>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}
