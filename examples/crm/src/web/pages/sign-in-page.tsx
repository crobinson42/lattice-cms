import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shadalaya/react/card';
import { Field, FieldGroup, FieldLabel } from '@shadalaya/react/field';
import { Input } from '@shadalaya/react/input';
import { isPFError } from '@ts-pf/protocol';
import { type FormEvent, useState } from 'react';
import { Redirect, useSearch } from 'wouter';
import { authClient } from '../auth.js';
import { nextPath, useSession } from '../session.js';

/**
 * Email and password, through /auth login, then back where the user was.
 * A signed-in user goes straight there.
 */
export function SignInPage() {
  const { signed, signIn } = useSession();
  const search = useSearch();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      signIn(
        await authClient(fetch).login({
          email: String(form.get('email')),
          password: String(form.get('password')),
        }),
      );
    } catch (refused) {
      setError(
        isPFError(refused) && refused.code === 'UNAUTHORIZED'
          ? 'The email or password is wrong.'
          : 'Signing in failed. Try again.',
      );
      setPending(false);
    }
  };
  if (signed !== null) {
    const next = new URLSearchParams(search).get('next');
    return <Redirect to={nextPath(next, window.location.origin)} replace />;
  }
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>With your work email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form aria-label="Sign in" onSubmit={(event) => void submit(event)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {error === undefined ? null : (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={pending}>
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
