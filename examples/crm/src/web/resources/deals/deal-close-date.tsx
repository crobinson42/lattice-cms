import { CalendarIcon } from 'lucide-react';
import { formatDay } from '../../ui/format.js';
import { isOverdue } from './deal.format.js';
import type { Deal } from './deal.js';

/**
 * A deal's expected close date, in red with "overdue" once an open deal
 * is past it; nothing when it has none.
 */
export function DealCloseDate({
  deal,
  today,
}: {
  readonly deal: Pick<Deal, 'expectedCloseDate' | 'closedAt'>;
  /** The browser's day, an ISO date: isoDay(new Date()). */
  readonly today: string;
}) {
  if (deal.expectedCloseDate === undefined) return null;
  const overdue = isOverdue(deal, today);
  return (
    <span
      className={`flex items-center gap-1 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      <CalendarIcon aria-hidden className="size-3.5" />
      <time dateTime={deal.expectedCloseDate}>
        {formatDay(deal.expectedCloseDate)}
      </time>
      {overdue ? <span>· overdue</span> : null}
    </span>
  );
}
