import { Button } from '@shadalaya/react/button';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { Building2Icon, PlusIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useLocation } from 'wouter';
import { useApi } from '../api.js';
import { companyCount } from '../resources/companies/company.format.js';
import type { CompanyCreate } from '../resources/companies/company.js';
import { companyColumns } from '../resources/companies/company-columns.js';
import { CompanyForm } from '../resources/companies/company-form.js';
import {
  companySorts,
  defaultCompanySort,
} from '../resources/companies/company-sorts.js';
import { LoadMore, useCursorPages } from '../ui/cursor-pages.js';
import { DataTable, DataTableSkeleton } from '../ui/data-table.js';
import { FormSheet } from '../ui/form.js';
import { useListParams } from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { SearchBox } from '../ui/search-box.js';
import { SortSelect } from '../ui/sort-select.js';
import { EmptyState, ErrorState } from '../ui/states.js';

/**
 * The organization's companies: searched by name and sorted, both kept in
 * the URL, a page at a time. New opens the form in a sheet, and a created
 * company opens its page.
 */
export function CompaniesPage() {
  const { rpc, swr } = useApi();
  const { mutate } = useSWRConfig();
  const [, navigate] = useLocation();
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

  const [creating, setCreating] = useState(false);
  const create = async (input: CompanyCreate) => {
    const result = await asResult(rpc.companies.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    toast.add({ title: `Created ${result.data.name}`, type: 'success' });
    void mutate(swr.companies.matcher());
    pages.refresh();
    navigate(`/companies/${result.data.id}`);
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
      {pages.rows === undefined ? (
        pages.error === undefined ? (
          <DataTableSkeleton label="Companies" columns={companyColumns} />
        ) : (
          <ErrorState
            message="The companies could not be loaded."
            onRetry={pages.refresh}
          />
        )
      ) : pages.rows.length === 0 ? (
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
      ) : (
        <>
          <DataTable
            label="Companies"
            columns={companyColumns}
            rows={pages.rows}
            rowKey={({ id }) => id}
            focusRow={pages.firstNew}
          />
          <LoadMore pages={pages} what="companies" />
        </>
      )}
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
