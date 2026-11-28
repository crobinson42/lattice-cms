import { Skeleton } from '@shadalaya/react/skeleton';
import type { ReactNode } from 'react';
import { type CursorPages, LoadMore } from '../../ui/cursor-pages.js';
import { dayGroups } from '../../ui/format.js';
import { useNow } from '../../ui/now.js';
import { ErrorState } from '../../ui/states.js';
import type { Activity } from './activity.js';

/**
 * A timeline, newest first, in groups by day: Today, Yesterday, then the
 * date. `item` draws each activity; `empty` shows when there are none.
 */
export function ActivityTimeline({
  label,
  pages,
  item,
  empty,
}: {
  /** What the timeline is, for assistive tech: "Activity on Acme". */
  readonly label: string;
  readonly pages: CursorPages<Activity>;
  readonly item: (activity: Activity) => ReactNode;
  readonly empty: ReactNode;
}) {
  // Today and Yesterday move on at midnight without a reload.
  const now = useNow(60_000);
  if (pages.rows === undefined) {
    return pages.error === undefined ? (
      <div aria-busy className="grid gap-4">
        {['a', 'b', 'c'].map((row) => (
          <div key={row} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <ErrorState
        message="The activity could not be loaded."
        onRetry={pages.refresh}
      />
    );
  }
  if (pages.rows.length === 0) return empty;
  return (
    <section aria-label={label} className="grid gap-6">
      {dayGroups(
        pages.rows,
        (activity) => activity.occurredAt,
        new Date(now),
      ).map(({ day, label: heading, items }) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h3
            id={`day-${day}`}
            className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {heading}
          </h3>
          <ul className="grid gap-4">
            {items.map((activity) => (
              <li key={activity.id}>{item(activity)}</li>
            ))}
          </ul>
        </section>
      ))}
      <LoadMore pages={pages} what="activity" />
    </section>
  );
}
