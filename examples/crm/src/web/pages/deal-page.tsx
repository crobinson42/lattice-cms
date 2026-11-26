import { Button, buttonVariants } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import {
  ArchiveIcon,
  BriefcaseIcon,
  PencilIcon,
  ThumbsDownIcon,
  TrophyIcon,
} from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'wouter';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import {
  type DealPatch,
  type DealWithCompany,
  readsAmounts,
} from '../resources/deals/deal.js';
import {
  closeDialog,
  useDealActions,
} from '../resources/deals/deal-actions.js';
import { DealForm } from '../resources/deals/deal-form.js';
import {
  DealOverview,
  DealOverviewSkeleton,
} from '../resources/deals/deal-overview.js';
import { DealStageBadge } from '../resources/deals/deal-stage-badge.js';
import { isOpen } from '../resources/deals/deal-stages.js';
import { useAfterWrite } from '../ui/after-write.js';
import { ConfirmAction } from '../ui/confirm-action.js';
import { deleteRefusal } from '../ui/confirm-delete.js';
import { FormSheet } from '../ui/form.js';
import { PageHeader } from '../ui/page-header.js';
import type { Crumb } from '../ui/shell.js';
import { EmptyState, ErrorState } from '../ui/states.js';
import { type Team, TeamGate } from '../workspace/team.js';
import { ActivitySection } from './activity-section.js';
import { DealContacts } from './deal-contacts.js';
import { TaskSection } from './task-section.js';

const parents: readonly Crumb[] = [{ label: 'Deals', href: '/deals' }];

/** One deal, with its company: the overview, close, edit and archive. */
export default function DealPage({ id }: { readonly id: string }) {
  const { swr } = useApi();
  // The literal populate in the call is what types the company in.
  const { data, error, mutate } = useSWR(
    swr.deals.get.key({ input: { id, populate: ['companyId'] } }),
    () => swr.deals.get({ id, populate: ['companyId'] }),
  );
  // Before the data: SWR keeps the last data when a read fails, and an
  // archived deal must not show as if it were there.
  if (isPFError(error) && error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        title="Deal not found"
        description="It was archived, or it belongs to another organization."
        action={
          <Link
            href="/deals"
            className={buttonVariants({ variant: 'outline' })}
          >
            Back to deals
          </Link>
        }
      />
    );
  }
  if (data !== undefined) {
    return <TeamGate>{(team) => <Loaded deal={data} team={team} />}</TeamGate>;
  }
  if (error === undefined) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <DealOverviewSkeleton />
      </>
    );
  }
  return (
    <ErrorState
      message="The deal could not be loaded."
      onRetry={() => void mutate()}
    />
  );
}

function Loaded({
  deal,
  team,
}: {
  readonly deal: DealWithCompany;
  readonly team: Team;
}) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const searchCompanies = useCompanySearch();
  const [editing, setEditing] = useState(false);
  const open = isOpen(deal);

  const { changedElsewhere, close } = useDealActions();

  const update = async (patch: DealPatch) => {
    // Nothing changed: nothing to send.
    if (Object.keys(patch).length > 0) {
      const result = await asResult(
        rpc.deals.update({ id: deal.id, ...patch }),
      );
      if (!result.ok) {
        if (!changedElsewhere(deal, result.error)) return result.error;
        setEditing(false);
        return undefined;
      }
      void afterWrite({
        changed: swr.deals.matcher(),
        says: `Saved ${result.data.title}`,
      });
    }
    setEditing(false);
    return undefined;
  };

  const archive = async () => {
    const result = await asResult(rpc.deals.delete({ id: deal.id }));
    if (result.ok) {
      void afterWrite({
        changed: swr.deals.matcher(),
        says: `Archived ${deal.title}`,
        goTo: '/deals',
      });
      return undefined;
    }
    return changedElsewhere(deal, result.error)
      ? undefined
      : deleteRefusal(deal.title, result.error);
  };

  return (
    <>
      <PageHeader
        title={deal.title}
        parents={parents}
        icon={<BriefcaseIcon />}
        description={<DealStageBadge stage={deal.stage} />}
        actions={
          <>
            {open ? (
              <>
                <ConfirmAction
                  trigger={
                    <>
                      <TrophyIcon />
                      Won
                    </>
                  }
                  {...closeDialog(deal, 'won')}
                  onConfirm={() => close(deal, 'won')}
                />
                <ConfirmAction
                  trigger={
                    <>
                      <ThumbsDownIcon />
                      Lost
                    </>
                  }
                  variant="outline"
                  {...closeDialog(deal, 'lost')}
                  onConfirm={() => close(deal, 'lost')}
                />
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit
                </Button>
              </>
            ) : null}
            <ConfirmAction
              trigger={
                <>
                  <ArchiveIcon />
                  Archive
                </>
              }
              variant="outline"
              title={`Archive ${deal.title}?`}
              description="It leaves every list. Its activities and tasks stay."
              confirm="Archive"
              pending="Archiving…"
              onConfirm={archive}
            />
          </>
        }
      />
      {open ? null : (
        <p className="mb-4 text-sm text-muted-foreground">
          Closed deals can’t be edited.
        </p>
      )}
      <DealOverview deal={deal} members={team.members} />
      <DealContacts deal={deal} companyId={deal.companyId.id} editable={open} />
      <TaskSection
        parent={{ on: 'deal', id: deal.id, companyId: deal.companyId.id }}
        name={deal.title}
      />
      <ActivitySection
        parent={{ on: 'deal', id: deal.id, companyId: deal.companyId.id }}
        name={deal.title}
      />
      <FormSheet
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${deal.title}`}
        description="Only what you change is saved."
      >
        <DealForm
          deal={deal}
          members={team.members}
          readsAmounts={readsAmounts(team.me)}
          searchCompanies={searchCompanies}
          onSubmit={update}
        />
      </FormSheet>
    </>
  );
}
