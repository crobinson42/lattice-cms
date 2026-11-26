import { Button } from '@shadalaya/react/button';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { PlusIcon, UsersIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useLocation } from 'wouter';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import { contactCount } from '../resources/contacts/contact.format.js';
import type { ContactCreate } from '../resources/contacts/contact.js';
import { contactColumns } from '../resources/contacts/contact-columns.js';
import { ContactForm } from '../resources/contacts/contact-form.js';
import {
  contactSorts,
  defaultContactSort,
} from '../resources/contacts/contact-sorts.js';
import { LoadMore, useCursorPages } from '../ui/cursor-pages.js';
import { DataTable, DataTableSkeleton } from '../ui/data-table.js';
import { FormSheet } from '../ui/form.js';
import { useListParams } from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { SearchBox } from '../ui/search-box.js';
import { SortSelect } from '../ui/sort-select.js';
import { EmptyState, ErrorState } from '../ui/states.js';

/**
 * The organization's contacts, each with their company: searched by name
 * and sorted, both kept in the URL, a page at a time. New opens the form in
 * a sheet, and a created contact opens their page.
 */
export default function ContactsPage() {
  const { rpc, swr } = useApi();
  const { mutate } = useSWRConfig();
  const [, navigate] = useLocation();
  const searchCompanies = useCompanySearch();
  const [params, show] = useListParams(contactSorts, defaultContactSort);
  const { sort } = params;
  const search = useCallback((q: string) => show({ q, sort }), [show, sort]);

  const filter =
    params.q === '' ? {} : { where: { name: { contains: params.q } } };
  const count = useSWR(
    swr.contacts.count.key({ input: filter }),
    swr.contacts.count.fetcher(),
  );
  // Each contact with their company, in one request per page.
  const pages = useCursorPages(
    swr.contacts.find.key,
    { ...filter, sort: [sort], limit: 20, populate: ['companyId'] },
    (input) => swr.contacts.find({ ...input, populate: ['companyId'] }),
  );

  const [creating, setCreating] = useState(false);
  const create = async (input: ContactCreate) => {
    const result = await asResult(rpc.contacts.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    toast.add({ title: `Created ${result.data.name}`, type: 'success' });
    void mutate(swr.contacts.matcher());
    pages.refresh();
    navigate(`/contacts/${result.data.id}`);
    return undefined;
  };

  const newContact = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New contact
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Contacts"
        icon={<UsersIcon />}
        description={
          count.data === undefined ? undefined : contactCount(count.data.count)
        }
        actions={newContact}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox
          q={params.q}
          onSearch={search}
          label="Search contacts"
          placeholder="Search by name"
        />
        <SortSelect
          sorts={contactSorts}
          value={sort}
          onChange={(next) => show({ ...params, sort: next })}
        />
      </div>
      {pages.rows === undefined ? (
        pages.error === undefined ? (
          <DataTableSkeleton label="Contacts" columns={contactColumns} />
        ) : (
          <ErrorState
            message="The contacts could not be loaded."
            onRetry={pages.refresh}
          />
        )
      ) : pages.rows.length === 0 ? (
        params.q === '' ? (
          <EmptyState
            title="No contacts yet"
            description="Add the people you work with at your companies."
            action={newContact}
          />
        ) : (
          <EmptyState
            title={`No contacts match “${params.q}”`}
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
            label="Contacts"
            columns={contactColumns}
            rows={pages.rows}
            rowKey={({ id }) => id}
            focusRow={pages.firstNew}
          />
          <LoadMore pages={pages} what="contacts" />
        </>
      )}
      <FormSheet
        open={creating}
        onOpenChange={setCreating}
        title="New contact"
        description="A name, an email address and a company are required."
      >
        <ContactForm searchCompanies={searchCompanies} onSubmit={create} />
      </FormSheet>
    </>
  );
}
