import { DetailList, DetailListSkeleton } from '../../ui/detail-list.js';
import { formatDate, formatDay, formatRelative } from '../../ui/format.js';
import { CompanyInline } from '../companies/company-inline.js';
import { type Member, memberOf } from '../members/member.js';
import { MemberInline } from '../members/member-inline.js';
import type { DealWithCompany } from './deal.js';
import { DealAmount } from './deal-amount.js';

/**
 * A detail section: the deal's own fields, its company and its owner, whom
 * `members` names. The page shows the stage, under its title.
 */
export function DealOverview({
  deal,
  members,
}: {
  readonly deal: DealWithCompany;
  readonly members: readonly Member[];
}) {
  return (
    <DetailList
      label="Overview"
      details={[
        { label: 'Company', value: <CompanyInline company={deal.companyId} /> },
        {
          label: 'Amount',
          value: <DealAmount deal={deal} />,
        },
        {
          label: 'Owner',
          value:
            deal.ownerId === undefined ? (
              'Unassigned'
            ) : (
              <MemberInline member={memberOf(members, deal.ownerId)} />
            ),
        },
        {
          label: 'Expected close',
          value:
            deal.expectedCloseDate === undefined ? undefined : (
              <time dateTime={deal.expectedCloseDate}>
                {formatDay(deal.expectedCloseDate)}
              </time>
            ),
        },
        {
          label: 'Closed',
          value:
            deal.closedAt === undefined ? undefined : (
              <time dateTime={deal.closedAt}>{formatDate(deal.closedAt)}</time>
            ),
        },
        {
          label: 'Updated',
          value: (
            <time dateTime={deal.updatedAt}>
              {formatRelative(deal.updatedAt)}
            </time>
          ),
        },
      ]}
    />
  );
}

/** DealOverview's place while the deal loads. */
export function DealOverviewSkeleton() {
  return <DetailListSkeleton rows={6} />;
}
