import { Button } from '@shadalaya/react/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import { BriefcaseIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useLocation } from 'wouter';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import { dealCount } from '../resources/deals/deal.format.js';
import { type DealCreate, readsAmounts } from '../resources/deals/deal.js';
import { dealColumns } from '../resources/deals/deal-columns.js';
import { DealForm } from '../resources/deals/deal-form.js';
import { dealSorts, defaultDealSort } from '../resources/deals/deal-sorts.js';
import { allStages, dealStages } from '../resources/deals/deal-stages.js';
import { useAfterWrite } from '../ui/after-write.js';
import { useCursorPages } from '../ui/cursor-pages.js';
import { CursorTable } from '../ui/cursor-table.js';
import { FormSheet } from '../ui/form.js';
import {
  useListParams,
  useUrlOption,
  writeListParams,
} from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { SearchBox } from '../ui/search-box.js';
import { SortSelect } from '../ui/sort-select.js';
import { EmptyState } from '../ui/states.js';
import { type Team, TeamGate, useTeam } from '../workspace/team.js';

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
  const { refresh: refreshTeam } = useTeam();
  const searchCompanies = useCompanySearch();
  const amounts = readsAmounts(team.me);
  const sorts = dealSorts(amounts);
  const [params, show] = useListParams(sorts, defaultDealSort);
  const [stage, setStage] = useUrlOption('stage', allStages);
  const { sort } = params;
  const search = useCallback((q: string) => show({ q, sort }), [show, sort]);

  const where = {
    ...(params.q === '' ? {} : { title: { contains: params.q } }),
    ...(stage === undefined ? {} : { stage: { eq: stage } }),
  };
  const count = useSWR(
    swr.deals.count.key({ input: { where } }),
    swr.deals.count.fetcher(),
  );
  // Each deal with its company, in one request per page.
  const pages = useCursorPages(
    swr.deals.find.key,
    { where, sort: [sort], limit: 20, populate: ['companyId'] },
    (input) => swr.deals.find({ ...input, populate: ['companyId'] }),
  );
  // A read refused as VALIDATION is a sort the member may no longer use,
  // such as amount after a demotion: read their role again, and the sorts
  // offered follow.
  const refused = isPFError(pages.error) && pages.error.code === 'VALIDATION';
  useEffect(() => {
    if (refused) refreshTeam();
  }, [refused, refreshTeam]);

  const [creating, setCreating] = useState(false);
  const create = async (input: DealCreate) => {
    const result = await asResult(rpc.deals.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    afterWrite({
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
          count.data === undefined ? undefined : dealCount(count.data.count)
        }
        actions={newDeal}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox
          q={params.q}
          onSearch={search}
          label="Search deals"
          placeholder="Search by title"
        />
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
        <SortSelect
          sorts={sorts}
          value={sort}
          onChange={(next) => show({ ...params, sort: next })}
        />
      </div>
      <CursorTable
        label="Deals"
        columns={dealColumns(team.members)}
        pages={pages}
        what="deals"
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
                      `/deals${writeListParams({ q: '', sort }, defaultDealSort)}`,
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
