import { Skeleton } from '@shadalaya/react/skeleton';
import type { ReactNode } from 'react';

/** One row of a DetailList: what it is, and its value, or nothing. */
export type Detail = {
  readonly label: string;
  readonly value: ReactNode;
};

/**
 * A detail section: label and value pairs in a card, named for assistive
 * tech. A value of undefined shows as a dash.
 */
export function DetailList({
  label,
  details,
}: {
  readonly label: string;
  readonly details: readonly Detail[];
}) {
  return (
    <section aria-label={label} className="rounded-lg border p-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {details.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** DetailList's place while its document loads. */
export function DetailListSkeleton({ rows }: { readonly rows: number }) {
  return (
    <section aria-busy className="rounded-lg border p-4">
      <div className="grid gap-2">
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no id.
          <Skeleton key={row} className="h-4 w-64" />
        ))}
      </div>
    </section>
  );
}

/** A phone number that calls it. */
export function PhoneLink({ phone }: { readonly phone: string }) {
  return <a href={`tel:${phone}`}>{phone}</a>;
}
