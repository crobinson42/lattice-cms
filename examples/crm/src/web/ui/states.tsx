import { Alert, AlertAction, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shadalaya/react/empty';
import { Spinner } from '@shadalaya/react/spinner';
import { Component, type ReactNode } from 'react';

// The states every data-bound part of the app shows while it has no data:
// loading, nothing there yet, and a failure the user can retry.

/** Waiting for data. */
export function Loading() {
  return (
    <div className="flex justify-center p-12 text-muted-foreground">
      <Spinner className="size-6" />
    </div>
  );
}

/** Nothing to show yet, and optionally what to do about it. */
export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description === undefined ? null : (
          <EmptyDescription>{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** A failure, and a way to try again. */
export function ErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <Alert variant="destructive" className="mx-auto my-12 max-w-md">
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * `fallback` in place of its children when they throw while rendering,
 * such as a lazy chunk that fails to load after a deploy.
 */
export class ErrorBoundary extends Component<
  { readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
