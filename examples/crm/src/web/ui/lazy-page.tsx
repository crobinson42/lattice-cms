import { type ReactNode, Suspense } from 'react';
import { ErrorBoundary, ErrorState } from './states.js';

/**
 * A page whose code loads when it first opens: `fallback` until it is
 * there. A chunk that fails to load, such as an old hash after a deploy,
 * offers a reload.
 */
export function LazyPage({
  fallback,
  children,
}: {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <ErrorState
          message="This page could not be loaded."
          onRetry={() => window.location.reload()}
        />
      }
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
