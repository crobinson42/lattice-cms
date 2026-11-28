import type { Deal } from './deal.js';
import { isOpen } from './deal-stages.js';

/** "1 open deal", "12 open deals". */
export function openDealCount(count: number): string {
  return count === 1 ? '1 open deal' : `${count} open deals`;
}

/** "1 deal", "12 deals". */
export function dealCount(count: number): string {
  return count === 1 ? '1 deal' : `${count} deals`;
}

/**
 * Whether an open deal is past its expected close date: `today` is the
 * browser's day, an ISO date. A closed deal is never overdue, and neither
 * is one closing today.
 */
export function isOverdue(
  deal: Pick<Deal, 'expectedCloseDate' | 'closedAt'>,
  today: string,
): boolean {
  return (
    isOpen(deal) &&
    deal.expectedCloseDate !== undefined &&
    deal.expectedCloseDate < today
  );
}
