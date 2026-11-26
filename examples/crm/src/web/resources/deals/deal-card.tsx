import { CalendarIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDay } from '../../ui/format.js';
import { isReadableCompany } from '../companies/company.js';
import { displayName } from '../members/member.format.js';
import type { Member } from '../members/member.js';
import { MemberAvatar } from '../members/member-avatar.js';
import { isOverdue } from './deal.format.js';
import type { DealWithCompany } from './deal.js';
import { DealAmount } from './deal-amount.js';
import { DealInline } from './deal-inline.js';

/**
 * A deal on the board: its title, linking to it, its company, amount,
 * owner and expected close date, overdue in red. `actions` is its menu;
 * `moving` dims it while a move is on its way.
 */
export function DealCard({
  deal,
  owner,
  today,
  moving,
  actions,
}: {
  readonly deal: DealWithCompany;
  /** The owner, from the team, or undefined when unassigned or gone. */
  readonly owner: Member | undefined;
  /** The browser's day, an ISO date: isoDay(new Date()). */
  readonly today: string;
  readonly moving: boolean;
  readonly actions: ReactNode;
}) {
  const overdue = isOverdue(deal, today);
  return (
    <article
      aria-busy={moving}
      className={`grid gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs ${moving ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <DealInline deal={deal} />
        {actions}
      </div>
      <div className="text-muted-foreground">
        {isReadableCompany(deal.companyId)
          ? deal.companyId.name
          : 'Hidden company'}
      </div>
      <div className="flex items-center justify-between gap-2">
        <DealAmount deal={deal} />
        {owner === undefined ? null : (
          <span title={displayName(owner)}>
            <MemberAvatar member={owner} />
          </span>
        )}
      </div>
      {deal.expectedCloseDate === undefined ? null : (
        <div
          className={`flex items-center gap-1 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          <CalendarIcon aria-hidden className="size-3.5" />
          <time dateTime={deal.expectedCloseDate}>
            {formatDay(deal.expectedCloseDate)}
          </time>
          {overdue ? <span>· overdue</span> : null}
        </div>
      )}
      {moving ? <div className="text-muted-foreground">Moving…</div> : null}
    </article>
  );
}
