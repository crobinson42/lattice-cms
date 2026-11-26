import { Button, buttonVariants } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import { Building2Icon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'wouter';
import { useApi } from '../api.js';
import type { Company, CompanyPatch } from '../resources/companies/company.js';
import { CompanyForm } from '../resources/companies/company-form.js';
import {
  CompanyOverview,
  CompanyOverviewSkeleton,
} from '../resources/companies/company-overview.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import type { ContactCreate } from '../resources/contacts/contact.js';
import { companyContactColumns } from '../resources/contacts/contact-columns.js';
import { ContactForm } from '../resources/contacts/contact-form.js';
import { type DealCreate, readsAmounts } from '../resources/deals/deal.js';
import { companyDealColumns } from '../resources/deals/deal-columns.js';
import { DealForm } from '../resources/deals/deal-form.js';
import { useAfterWrite } from '../ui/after-write.js';
import { ConfirmDelete } from '../ui/confirm-delete.js';
import { useCursorPages } from '../ui/cursor-pages.js';
import { CursorTable } from '../ui/cursor-table.js';
import { FormSheet } from '../ui/form.js';
import { PageHeader } from '../ui/page-header.js';
import { Section } from '../ui/section.js';
import type { Crumb } from '../ui/shell.js';
import { EmptyState, ErrorState } from '../ui/states.js';
import { TeamGate } from '../workspace/team.js';
import { ActivitySection } from './activity-section.js';
import { TaskSection } from './task-section.js';

const parents: readonly Crumb[] = [{ label: 'Companies', href: '/companies' }];

/** One company: its overview, its contacts and deals, and edit and delete. */
export default function CompanyPage({ id }: { readonly id: string }) {
  const { swr } = useApi();
  const { data, error, mutate } = useSWR(
    swr.companies.get.key({ input: { id } }),
    swr.companies.get.fetcher(),
  );
  // Before the data: SWR keeps the last data when a read fails, and a
  // deleted company must not show as if it were there.
  if (isPFError(error) && error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        title="Company not found"
        description="It was deleted, or it belongs to another organization."
        action={
          <Link
            href="/companies"
            className={buttonVariants({ variant: 'outline' })}
          >
            Back to companies
          </Link>
        }
      />
    );
  }
  if (data !== undefined) return <Loaded company={data} />;
  if (error === undefined) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <CompanyOverviewSkeleton />
      </>
    );
  }
  return (
    <ErrorState
      message="The company could not be loaded."
      onRetry={() => void mutate()}
    />
  );
}

function Loaded({ company }: { readonly company: Company }) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const [editing, setEditing] = useState(false);

  const update = async (patch: CompanyPatch) => {
    // Nothing changed: nothing to send.
    if (Object.keys(patch).length > 0) {
      const result = await asResult(
        rpc.companies.update({ id: company.id, ...patch }),
      );
      if (!result.ok) return result.error;
      void afterWrite({
        changed: swr.companies.matcher(),
        says: `Saved ${result.data.name}`,
      });
    }
    setEditing(false);
    return undefined;
  };

  const remove = async () => {
    const result = await asResult(rpc.companies.delete({ id: company.id }));
    if (!result.ok) return result.error;
    void afterWrite({
      changed: swr.companies.matcher(),
      says: `Deleted ${company.name}`,
      goTo: '/companies',
    });
    return undefined;
  };

  return (
    <>
      <PageHeader
        title={company.name}
        parents={parents}
        icon={<Building2Icon />}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
            <ConfirmDelete
              name={company.name}
              consequence="Its activities and tasks are deleted with it. This cannot be undone."
              onDelete={remove}
            />
          </>
        }
      />
      <CompanyOverview company={company} />
      <CompanyContacts company={company} />
      <CompanyDeals company={company} />
      <TaskSection
        parent={{ on: 'company', id: company.id }}
        name={company.name}
      />
      <ActivitySection
        parent={{ on: 'company', id: company.id }}
        name={company.name}
      />
      <FormSheet
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${company.name}`}
        description="Only what you change is saved."
      >
        <CompanyForm company={company} onSubmit={update} />
      </FormSheet>
    </>
  );
}

/**
 * The company's contacts, a page at a time. New contact opens the form with
 * the company already picked.
 */
function CompanyContacts({ company }: { readonly company: Company }) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const searchCompanies = useCompanySearch();
  const pages = useCursorPages(
    swr.contacts.find.key,
    { where: { companyId: { eq: company.id } }, sort: ['name'], limit: 20 },
    (input) => swr.contacts.find(input),
  );
  const [creating, setCreating] = useState(false);
  const create = async (input: ContactCreate) => {
    const result = await asResult(rpc.contacts.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    void afterWrite({
      changed: swr.contacts.matcher(),
      says: `Created ${result.data.name}`,
    });
    return undefined;
  };
  const newContact = (
    <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
      <PlusIcon />
      New contact
    </Button>
  );
  return (
    <Section
      id="contacts"
      title="Contacts"
      action={pages.rows?.length ? newContact : undefined}
    >
      <CursorTable
        label={`Contacts at ${company.name}`}
        columns={companyContactColumns}
        pages={pages}
        what="contacts"
        skeletonRows={3}
        empty={
          <EmptyState
            title="No contacts yet"
            description={`Add the people you work with at ${company.name}.`}
            action={newContact}
          />
        }
      />
      <FormSheet
        open={creating}
        onOpenChange={setCreating}
        title={`New contact at ${company.name}`}
        description="A name and an email address are required."
      >
        <ContactForm
          company={company}
          searchCompanies={searchCompanies}
          onSubmit={create}
        />
      </FormSheet>
    </Section>
  );
}

/**
 * The company's deals, a page at a time. New deal opens the form with the
 * company already picked. It needs the team, for owners and the role.
 */
function CompanyDeals({ company }: { readonly company: Company }) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const searchCompanies = useCompanySearch();
  const pages = useCursorPages(
    swr.deals.find.key,
    {
      where: { companyId: { eq: company.id } },
      sort: ['-createdAt'],
      limit: 20,
    },
    (input) => swr.deals.find(input),
  );
  const [creating, setCreating] = useState(false);
  const create = async (input: DealCreate) => {
    const result = await asResult(rpc.deals.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    void afterWrite({
      changed: swr.deals.matcher(),
      says: `Created ${result.data.title}`,
    });
    return undefined;
  };
  const newDeal = (
    <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
      <PlusIcon />
      New deal
    </Button>
  );
  return (
    <TeamGate>
      {(team) => (
        <Section
          id="deals"
          title="Deals"
          action={pages.rows?.length ? newDeal : undefined}
        >
          <CursorTable
            label={`Deals at ${company.name}`}
            columns={companyDealColumns(team.members)}
            pages={pages}
            what="deals"
            skeletonRows={3}
            empty={
              <EmptyState
                title="No deals yet"
                description={`Add what you are selling to ${company.name}.`}
                action={newDeal}
              />
            }
          />
          <FormSheet
            open={creating}
            onOpenChange={setCreating}
            title={`New deal at ${company.name}`}
            description="A title and an amount are required."
          >
            <DealForm
              company={company}
              members={team.members}
              readsAmounts={readsAmounts(team.me)}
              searchCompanies={searchCompanies}
              onSubmit={create}
            />
          </FormSheet>
        </Section>
      )}
    </TeamGate>
  );
}
