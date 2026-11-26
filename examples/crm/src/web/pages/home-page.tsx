import { Skeleton } from '@shadalaya/react/skeleton';
import { HouseIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import useSWR from 'swr';
import { Link } from 'wouter';
import { useApi } from '../api.js';
import { activityPopulate } from '../resources/activities/activity.js';
import { ActivityItem } from '../resources/activities/activity-item.js';
import type { DealWhere } from '../resources/deals/deal.js';
import { DealItem } from '../resources/deals/deal-item.js';
import {
  dealStages,
  type OpenStage,
  openStages,
} from '../resources/deals/deal-stages.js';
import { memberOf } from '../resources/members/member.js';
import { isoDay, monthStart } from '../ui/format.js';
import { useNow } from '../ui/now.js';
import { PageHeader } from '../ui/page-header.js';
import { Section } from '../ui/section.js';
import { EmptyState, ErrorState } from '../ui/states.js';
import { type Team, TeamGate } from '../workspace/team.js';
import { TaskList } from './task-list.js';
import { useTaskPages } from './task-pages.js';

/**
 * The signed-in member's day: their tasks due, their open deals, the
 * pipeline in counts, and the organization's latest activity. Each section
 * reads on its own, so one that fails shows its retry and the rest stay.
 */
export default function HomePage() {
  return (
    <>
      <PageHeader title="Home" icon={<HouseIcon />} />
      <TeamGate>{(team) => <Dashboard team={team} />}</TeamGate>
    </>
  );
}

function Dashboard({ team }: { readonly team: Team }) {
  // Today and this month move on by themselves, without a reload.
  const now = new Date(useNow(60_000));
  const today = isoDay(now);
  return (
    <div className="grid items-start gap-x-8 lg:grid-cols-2">
      <div>
        <MyTasks team={team} today={today} />
        <MyDeals team={team} today={today} />
      </div>
      <div>
        <Pipeline since={monthStart(now)} />
        <RecentActivity team={team} />
      </div>
    </div>
  );
}

/** A link in a section's header, to the page with all of it. */
function ViewAll({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-sm font-medium underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

/** A section's rows while they load. */
function RowsSkeleton({ rows }: { readonly rows: number }) {
  return (
    <div aria-busy className="grid gap-3 py-2">
      {['a', 'b', 'c', 'd', 'e'].slice(0, rows).map((row) => (
        <Skeleton key={row} className="h-5 w-full" />
      ))}
    </div>
  );
}

/** My open tasks due today or before, checkable here as on the Tasks page. */
function MyTasks({
  team,
  today,
}: {
  readonly team: Team;
  readonly today: string;
}) {
  const pages = useTaskPages(
    {
      assigneeId: { eq: team.me.userId },
      done: { eq: false },
      dueDate: { lte: today },
    },
    ['dueDate', 'createdAt'],
    8,
  );
  // Where focus goes when the last row leaves.
  const top = useRef<HTMLDivElement>(null);
  return (
    <Section
      id="my-tasks"
      title="My tasks"
      action={<ViewAll href="/tasks">View all tasks</ViewAll>}
    >
      <div ref={top} tabIndex={-1} className="outline-none">
        <TaskList
          label="My tasks due"
          pages={pages}
          team={team}
          on={undefined}
          grouped
          loadMore={false}
          empty={<EmptyState title="Nothing due today" />}
          finalFocus={top}
        />
      </div>
    </Section>
  );
}

/** My open deals, closing soonest first; those with no date last. */
function MyDeals({
  team,
  today,
}: {
  readonly team: Team;
  readonly today: string;
}) {
  const { swr } = useApi();
  const where = {
    ownerId: { eq: team.me.userId },
    stage: { in: [...openStages] },
  };
  const deals = useSWR(
    swr.deals.find.key({
      input: {
        where,
        sort: ['expectedCloseDate'],
        limit: 5,
        populate: ['companyId'],
      },
    }),
    () =>
      swr.deals.find({
        where,
        sort: ['expectedCloseDate'],
        limit: 5,
        populate: ['companyId'],
      }),
  );
  return (
    <Section
      id="my-deals"
      title="My deals"
      action={<ViewAll href="/deals">View pipeline</ViewAll>}
    >
      {deals.error !== undefined ? (
        <ErrorState
          message="Your deals could not be loaded."
          onRetry={() => void deals.mutate()}
        />
      ) : deals.data === undefined ? (
        <RowsSkeleton rows={3} />
      ) : deals.data.docs.length === 0 ? (
        <EmptyState title="No open deals of yours" />
      ) : (
        <ul aria-label="My open deals" className="divide-y">
          {deals.data.docs.map((deal) => (
            <li key={deal.id}>
              <DealItem deal={deal} today={today} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** How many deals one `where` picks. */
function useDealCount(where: DealWhere) {
  const { swr } = useApi();
  return useSWR(
    swr.deals.count.key({ input: { where } }),
    swr.deals.count.fetcher(),
  );
}

/**
 * The pipeline in counts: the open deals in each stage, linking to the
 * board, and the deals won and lost since `since`, the start of this month,
 * each linking to the table of them.
 */
function Pipeline({ since }: { readonly since: string }) {
  const [lead, qualified, proposal, negotiation] = openStages;
  const open = (stage: OpenStage) => ({
    label: dealStages[stage].label,
    href: '/deals',
    where: { stage: { eq: stage } },
  });
  const counts = [
    open(lead),
    open(qualified),
    open(proposal),
    open(negotiation),
    {
      label: 'Won this month',
      href: '/deals?view=table&stage=won',
      where: { stage: { eq: 'won' }, closedAt: { gte: since } },
    },
    {
      label: 'Lost this month',
      href: '/deals?view=table&stage=lost',
      where: { stage: { eq: 'lost' }, closedAt: { gte: since } },
    },
  ] as const satisfies readonly {
    readonly label: string;
    readonly href: string;
    readonly where: DealWhere;
  }[];
  // Six reads of a fixed list, in a fixed order: one hook each.
  const read = [
    useDealCount(counts[0].where),
    useDealCount(counts[1].where),
    useDealCount(counts[2].where),
    useDealCount(counts[3].where),
    useDealCount(counts[4].where),
    useDealCount(counts[5].where),
  ];
  return (
    <Section id="pipeline" title="Pipeline">
      {read.some(({ error }) => error !== undefined) ? (
        <ErrorState
          message="The pipeline could not be loaded."
          onRetry={() => {
            for (const count of read) void count.mutate();
          }}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {counts.map(({ label, href }, index) => {
            const count = read[index]?.data?.count;
            return (
              <li key={label}>
                <Link
                  href={href}
                  className="grid gap-1 rounded-lg border p-3 hover:bg-muted"
                >
                  <span className="text-sm text-muted-foreground">{label}</span>
                  {count === undefined ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <span className="text-2xl font-semibold tabular-nums">
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** The organization's last ten activities, each linking to its records. */
function RecentActivity({ team }: { readonly team: Team }) {
  const { swr } = useApi();
  const recent = useSWR(
    swr.activities.find.key({
      input: {
        sort: ['-occurredAt'],
        limit: 10,
        populate: [...activityPopulate],
      },
    }),
    () =>
      swr.activities.find({
        sort: ['-occurredAt'],
        limit: 10,
        populate: [...activityPopulate],
      }),
  );
  return (
    <Section id="recent-activity" title="Recent activity">
      {recent.error !== undefined ? (
        <ErrorState
          message="The latest activity could not be loaded."
          onRetry={() => void recent.mutate()}
        />
      ) : recent.data === undefined ? (
        <RowsSkeleton rows={4} />
      ) : recent.data.docs.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ul aria-label="Recent activity" className="grid gap-4">
          {recent.data.docs.map((activity) => (
            <li key={activity.id}>
              <ActivityItem
                activity={activity}
                author={memberOf(team.members, activity.authorId)}
                on={undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
