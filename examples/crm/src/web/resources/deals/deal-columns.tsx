import type { Column } from '../../ui/data-table.js';
import { formatDay } from '../../ui/format.js';
import { CompanyInline } from '../companies/company-inline.js';
import { type Member, memberOf } from '../members/member.js';
import { MemberInline } from '../members/member-inline.js';
import type { Deal, DealWithCompany } from './deal.js';
import { DealAmount } from './deal-amount.js';
import { DealInline } from './deal-inline.js';
import { DealStageBadge } from './deal-stage-badge.js';

type Basics = Pick<
  Deal,
  'id' | 'title' | 'stage' | 'amount' | 'ownerId' | 'expectedCloseDate'
>;

/** The columns every table of deals shares, by name: `members` names owners. */
function shared(members: readonly Member[]) {
  const title: Column<Basics> = {
    key: 'title',
    header: 'Title',
    cell: (deal) => <DealInline deal={deal} />,
  };
  const stage: Column<Basics> = {
    key: 'stage',
    header: 'Stage',
    cell: (deal) => <DealStageBadge stage={deal.stage} />,
  };
  const amount: Column<Basics> = {
    key: 'amount',
    header: 'Amount',
    cell: (deal) => <DealAmount deal={deal} />,
  };
  const owner: Column<Basics> = {
    key: 'owner',
    header: 'Owner',
    cell: (deal) =>
      deal.ownerId === undefined ? (
        <span className="text-muted-foreground">Unassigned</span>
      ) : (
        <MemberInline member={memberOf(members, deal.ownerId)} />
      ),
  };
  const close: Column<Basics> = {
    key: 'expectedCloseDate',
    header: 'Expected close',
    cell: (deal) =>
      deal.expectedCloseDate === undefined ? undefined : (
        <time dateTime={deal.expectedCloseDate}>
          {formatDay(deal.expectedCloseDate)}
        </time>
      ),
  };
  return { title, stage, amount, owner, close };
}

/** The columns any table of deals shows, read with their company. */
export function dealColumns(
  members: readonly Member[],
): readonly Column<DealWithCompany>[] {
  const { title, stage, amount, owner, close } = shared(members);
  return [
    title,
    {
      key: 'company',
      header: 'Company',
      cell: (deal) => <CompanyInline company={deal.companyId} />,
    },
    stage,
    amount,
    owner,
    close,
  ];
}

/** The columns of a company's own deals: the company goes without saying. */
export function companyDealColumns(
  members: readonly Member[],
): readonly Column<Basics>[] {
  const { title, stage, amount, owner, close } = shared(members);
  return [title, stage, amount, owner, close];
}
