import { Button, buttonVariants } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import {
  ArchiveIcon,
  BriefcaseIcon,
  PencilIcon,
  ThumbsDownIcon,
  TrophyIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Link } from 'wouter';
import type { ApiError } from '../api.js';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import {
  type DealPatch,
  type DealWithCompany,
  readsAmounts,
} from '../resources/deals/deal.js';
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
  const { mutate } = useSWRConfig();
  const afterWrite = useAfterWrite();
  const searchCompanies = useCompanySearch();
  const [editing, setEditing] = useState(false);
  const open = isOpen(deal);

  /**
   * Whether `error` says another tab changed the deal first: closed it
   * (AlreadyClosed), or closed or archived it, which a write's filter
   * answers as NOT_FOUND. The page reads the deal again, and shows it
   * closed, or not found; a toast says why.
   */
  const changedElsewhere = useCallback(
    (error: ApiError): boolean => {
      if (error.code !== 'AlreadyClosed' && error.code !== 'NOT_FOUND') {
        return false;
      }
      toast.add({
        title:
          error.code === 'AlreadyClosed'
            ? `${deal.title} was already closed, perhaps in another tab.`
            : `${deal.title} was closed or archived, perhaps in another tab.`,
        type: 'error',
      });
      void mutate(swr.deals.matcher());
      return true;
    },
    [deal.title, mutate, swr],
  );

  const update = async (patch: DealPatch) => {
    // Nothing changed: nothing to send.
    if (Object.keys(patch).length > 0) {
      const result = await asResult(
        rpc.deals.update({ id: deal.id, ...patch }),
      );
      if (!result.ok) {
        if (!changedElsewhere(result.error)) return result.error;
        setEditing(false);
        return undefined;
      }
      afterWrite({
        changed: swr.deals.matcher(),
        says: `Saved ${result.data.title}`,
      });
    }
    setEditing(false);
    return undefined;
  };

  // A refusal that the page shows by reading the deal again closes the
  // dialog: the dialog itself may be gone with the open deal's buttons.
  const close = async (outcome: 'won' | 'lost') => {
    const result = await asResult(rpc.deals.close({ id: deal.id, outcome }));
    if (result.ok) {
      afterWrite({
        changed: swr.deals.matcher(),
        says: `Closed ${deal.title} as ${outcome}`,
      });
      return undefined;
    }
    return changedElsewhere(result.error) ? undefined : result.error.message;
  };

  const archive = async () => {
    const result = await asResult(rpc.deals.delete({ id: deal.id }));
    if (result.ok) {
      afterWrite({
        changed: swr.deals.matcher(),
        says: `Archived ${deal.title}`,
        goTo: '/deals',
      });
      return undefined;
    }
    return changedElsewhere(result.error)
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
                  title={`Close ${deal.title} as won?`}
                  description="A deal closes once, and then cannot be edited."
                  confirm="Close as won"
                  pending="Closing…"
                  onConfirm={() => close('won')}
                />
                <ConfirmAction
                  trigger={
                    <>
                      <ThumbsDownIcon />
                      Lost
                    </>
                  }
                  variant="outline"
                  title={`Close ${deal.title} as lost?`}
                  description="A deal closes once, and then cannot be edited."
                  confirm="Close as lost"
                  pending="Closing…"
                  onConfirm={() => close('lost')}
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
