import { Button } from '@shadalaya/react/button';
import { ButtonGroup } from '@shadalaya/react/button-group';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { asResult } from '@ts-pf/client';
import { BriefcaseIcon, KanbanIcon, PlusIcon, TableIcon } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';
import useSWR from 'swr';
import { useLocation } from 'wouter';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import { dealCount, openDealCount } from '../resources/deals/deal.format.js';
import {
  type DealCreate,
  type DealWhere,
  dealTitleSearch,
  readsAmounts,
} from '../resources/deals/deal.js';
import { dealColumns } from '../resources/deals/deal-columns.js';
import { DealForm } from '../resources/deals/deal-form.js';
import {
  type DealSort,
  dealSorts,
  defaultDealSort,
} from '../resources/deals/deal-sorts.js';
import {
  allStages,
  dealStages,
  openStages,
} from '../resources/deals/deal-stages.js';
import { useAfterWrite } from '../ui/after-write.js';
import { useCursorPages } from '../ui/cursor-pages.js';
import { CursorTable } from '../ui/cursor-table.js';
import { FormSheet } from '../ui/form.js';
import {
  useListParams,
  useNewSheet,
  useUrlOption,
  writeListParams,
} from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { SearchBox } from '../ui/search-box.js';
import { SortSelect } from '../ui/sort-select.js';
import { EmptyState } from '../ui/states.js';
import { type Team, TeamGate, useRoleRecheck } from '../workspace/team.js';
import { DealsBoard } from './deals-board.js';

const views = ['table'] as const;

/**
 * The organization's deals, each with its company: searched by title,
 * filtered by stage and sorted, all kept in the URL, a page at a time. New
 * opens the form in a sheet, and a created deal opens its page. What it
 * offers depends on the signed-in member's role, so it waits for the team.
 */
export default function DealsPage() {
  return <TeamGate>{(team) => <Deals team={team} />}</TeamGate>;
}

function Deals({ team }: { readonly team: Team }) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const [, navigate] = useLocation();
  const searchCompanies = useCompanySearch(20);
  const amounts = readsAmounts(team.me);
  const sorts = dealSorts(amounts);
  const [params, show] = useListParams(sorts, defaultDealSort);
  // The board is the default view; the table is `?view=table`.
  const [view, setView] = useUrlOption('view', views);
  const board = view === undefined;
  const [tableStage, setStage] = useUrlOption('stage', allStages);
  // The board shows the open stages as columns: a stage filter is the table's.
  const stage = board ? undefined : tableStage;
  const { sort } = params;
  const onSearch = useCallback((q: string) => show({ q, sort }), [show, sort]);

  const search = dealTitleSearch(params.q);
  // The header counts what the view shows: the open deals on the board,
  // the deals the filters pick in the table.
  const counted = board
    ? { ...search, stage: { in: [...openStages] } }
    : { ...search, ...(stage === undefined ? {} : { stage: { eq: stage } }) };
  const count = useSWR(
    swr.deals.count.key({ input: { where: counted } }),
    swr.deals.count.fetcher(),
  );

  const [creating, setCreating] = useNewSheet();
  const create = async (input: DealCreate) => {
    const result = await asResult(rpc.deals.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    void afterWrite({
      changed: swr.deals.matcher(),
      says: `Created ${result.data.title}`,
      goTo: `/deals/${result.data.id}`,
    });
    return undefined;
  };

  const newDeal = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New deal
    </Button>
  );
  const filtered = params.q !== '' || stage !== undefined;
  return (
    <>
      <PageHeader
        title="Deals"
        icon={<BriefcaseIcon />}
        description={
          count.data === undefined
            ? undefined
            : board
              ? openDealCount(count.data.count)
              : dealCount(count.data.count)
        }
        actions={
          <>
            <ButtonGroup aria-label="View">
              <Button
                variant={board ? 'default' : 'outline'}
                aria-pressed={board}
                onClick={() => setView(undefined)}
              >
                <KanbanIcon />
                Board
              </Button>
              <Button
                variant={board ? 'outline' : 'default'}
                aria-pressed={!board}
                onClick={() => setView('table')}
              >
                <TableIcon />
                Table
              </Button>
            </ButtonGroup>
            {newDeal}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox
          q={params.q}
          onSearch={onSearch}
          label="Search deals"
          placeholder="Search by title"
        />
        {board ? null : (
          <NativeSelect
            aria-label="Stage"
            value={stage ?? ''}
            onChange={(event) =>
              setStage(allStages.find((value) => value === event.target.value))
            }
          >
            <NativeSelectOption value="">Any stage</NativeSelectOption>
            {allStages.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {dealStages[value].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <SortSelect
          sorts={sorts}
          value={sort}
          onChange={(next) => show({ ...params, sort: next })}
        />
      </div>
      {board ? (
        <DealsBoard team={team} where={search} q={params.q} sort={sort} />
      ) : (
        <DealsTable
          team={team}
          where={counted}
          sort={sort}
          empty={
            filtered ? (
              <EmptyState
                title="No deals match"
                action={
                  <Button
                    variant="outline"
                    // One navigation: the search and the stage go, the sort
                    // stays.
                    onClick={() =>
                      navigate(
                        `/deals${writeListParams({ q: '', sort }, defaultDealSort, '?view=table')}`,
                        { replace: true },
                      )
                    }
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No deals yet"
                description="Add the deals your team is working."
                action={newDeal}
              />
            )
          }
        />
      )}
      <FormSheet
        open={creating}
        onOpenChange={setCreating}
        title="New deal"
        description="A title, a company and an amount are required."
      >
        <DealForm
          members={team.members}
          readsAmounts={amounts}
          searchCompanies={searchCompanies}
          onSubmit={create}
        />
      </FormSheet>
    </>
  );
}

/**
 * The table view: each deal with its company, in one request per page.
 * Only the table reads it: the board reads a page per column.
 */
function DealsTable({
  team,
  where,
  sort,
  empty,
}: {
  readonly team: Team;
  readonly where: DealWhere;
  readonly sort: DealSort;
  readonly empty: ReactNode;
}) {
  const { swr } = useApi();
  const pages = useCursorPages(
    swr.deals.find.key,
    { where, sort: [sort], limit: 20, populate: ['companyId'] },
    (input) => swr.deals.find({ ...input, populate: ['companyId'] }),
  );
  useRoleRecheck(pages.error);
  return (
    <CursorTable
      label="Deals"
      columns={dealColumns(team.members)}
      pages={pages}
      what="deals"
      empty={empty}
    />
  );
}
