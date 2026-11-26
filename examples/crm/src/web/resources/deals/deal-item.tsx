import { CompanyInline } from '../companies/company-inline.js';
import type { DealWithCompany } from './deal.js';
import { DealAmount } from './deal-amount.js';
import { DealCloseDate } from './deal-close-date.js';
import { DealInline } from './deal-inline.js';
import { DealStageBadge } from './deal-stage-badge.js';

/**
 * A deal in a short list: its title, linking to it, its company, stage,
 * amount (Withheld from a member) and expected close date, overdue in red.
 */
export function DealItem({
  deal,
  today,
}: {
  readonly deal: DealWithCompany;
  /** The browser's day, an ISO date. */
  readonly today: string;
}) {
  return (
    <article className="grid gap-1 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DealInline deal={deal} />
        <DealAmount deal={deal} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <CompanyInline company={deal.companyId} />
        <DealStageBadge stage={deal.stage} />
        <DealCloseDate deal={deal} today={today} />
      </div>
    </article>
  );
}
