import { Button } from '@shadalaya/react/button';
import { asResult } from '@ts-pf/client';
import { Building2Icon, PlusIcon } from 'lucide-react';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useApi } from '../api.js';
import { companyCount } from '../resources/companies/company.format.js';
import type { CompanyCreate } from '../resources/companies/company.js';
import { companyColumns } from '../resources/companies/company-columns.js';
import { CompanyForm } from '../resources/companies/company-form.js';
import {
  companySorts,
  defaultCompanySort,
} from '../resources/companies/company-sorts.js';
import { useAfterWrite } from '../ui/after-write.js';
import { useCursorPages } from '../ui/cursor-pages.js';
import { CursorTable } from '../ui/cursor-table.js';
import { FormSheet } from '../ui/form.js';
import { useListParams, useNewSheet } from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { SearchBox } from '../ui/search-box.js';
import { SortSelect } from '../ui/sort-select.js';
import { EmptyState } from '../ui/states.js';

/**
 * The organization's companies: searched by name and sorted, both kept in
 * the URL, a page at a time. New opens the form in a sheet, and a created
 * company opens its page.
 */
export default function CompaniesPage() {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const [params, show] = useListParams(companySorts, defaultCompanySort);
  const { sort } = params;
  const search = useCallback((q: string) => show({ q, sort }), [show, sort]);

  const filter =
    params.q === '' ? {} : { where: { name: { contains: params.q } } };
  const count = useSWR(
    swr.companies.count.key({ input: filter }),
    swr.companies.count.fetcher(),
  );
  const pages = useCursorPages(
    swr.companies.find.key,
    { ...filter, sort: [sort], limit: 20 },
    (input) => swr.companies.find(input),
  );

  const [creating, setCreating] = useNewSheet();
  const create = async (input: CompanyCreate) => {
    const result = await asResult(rpc.companies.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    void afterWrite({
      changed: swr.companies.matcher(),
      says: `Created ${result.data.name}`,
      goTo: `/companies/${result.data.id}`,
    });
    return undefined;
  };

  const newCompany = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New company
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Companies"
        icon={<Building2Icon />}
        description={
          count.data === undefined ? undefined : companyCount(count.data.count)
        }
        actions={newCompany}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox
          q={params.q}
          onSearch={search}
          label="Search companies"
          placeholder="Search by name"
        />
        <SortSelect
          sorts={companySorts}
          value={sort}
          onChange={(next) => show({ ...params, sort: next })}
        />
      </div>
      <CursorTable
        label="Companies"
        columns={companyColumns}
        pages={pages}
        what="companies"
        empty={
          params.q === '' ? (
            <EmptyState
              title="No companies yet"
              description="Add the companies you sell to."
              action={newCompany}
            />
          ) : (
            <EmptyState
              title={`No companies match “${params.q}”`}
              action={
                <Button
                  variant="outline"
                  onClick={() => show({ ...params, q: '' })}
                >
                  Clear search
                </Button>
              }
            />
          )
        }
      />
      <FormSheet
        open={creating}
        onOpenChange={setCreating}
        title="New company"
        description="Only the name is required."
      >
        <CompanyForm onSubmit={create} />
      </FormSheet>
    </>
  );
}
