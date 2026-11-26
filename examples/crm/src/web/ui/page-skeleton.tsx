import { Skeleton } from '@shadalaya/react/skeleton';
import { DetailListSkeleton } from './detail-list.js';

// A page's shape while its code loads: no resource's columns or fields,
// which load with the page.

function HeaderSkeleton() {
  return (
    <div className="mb-6 flex items-start gap-3">
      <Skeleton className="size-6" />
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}

/** A list page while it loads: its header, its toolbar and its rows. */
export function ListPageSkeleton() {
  return (
    <div aria-busy>
      <HeaderSkeleton />
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-3">
        {['a', 'b', 'c', 'd', 'e'].map((row) => (
          <Skeleton key={row} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A detail page while it loads: its header and its overview. */
export function DetailPageSkeleton() {
  return (
    <div aria-busy>
      <HeaderSkeleton />
      <DetailListSkeleton rows={5} />
    </div>
  );
}

/** The dashboard while it loads: its header, and two columns of sections. */
export function DashboardPageSkeleton() {
  return (
    <div aria-busy>
      <HeaderSkeleton />
      <div className="grid gap-8 lg:grid-cols-2">
        {['a', 'b'].map((column) => (
          <div key={column} className="grid gap-3">
            <Skeleton className="h-6 w-32" />
            {['a', 'b', 'c'].map((row) => (
              <Skeleton key={row} className="h-6 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
