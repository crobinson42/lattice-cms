import { Alert, AlertDescription, AlertTitle } from '@shadalaya/react/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shadalaya/react/empty';
import { Skeleton } from '@shadalaya/react/skeleton';
import type { Refusal } from './refusal.js';

/** Rows still loading. */
export function Loading() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

/** Something that went wrong, as a title and a message. */
export function ErrorAlert({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** A refused or failed call: the server's code and message. */
export function RefusalAlert({ refusal }: { readonly refusal: Refusal }) {
  return <ErrorAlert title={refusal.code} message={refusal.message} />;
}

/** A page or document that is not there. */
export function NotFound({ what }: { readonly what: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Not found</EmptyTitle>
        <EmptyDescription>{what}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A list with no documents. */
export function NoDocuments({ plural }: { readonly plural: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No {plural}</EmptyTitle>
        <EmptyDescription>
          Nothing matches, or nothing is here yet.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
