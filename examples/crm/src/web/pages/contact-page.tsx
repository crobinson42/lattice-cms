import { Button, buttonVariants } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import { PencilIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Link, useLocation } from 'wouter';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import type {
  ContactPatch,
  ContactWithCompany,
} from '../resources/contacts/contact.js';
import { ContactForm } from '../resources/contacts/contact-form.js';
import {
  ContactOverview,
  ContactOverviewSkeleton,
} from '../resources/contacts/contact-overview.js';
import { ConfirmDelete } from '../ui/confirm-delete.js';
import { FormSheet } from '../ui/form.js';
import { PageHeader } from '../ui/page-header.js';
import type { Crumb } from '../ui/shell.js';
import { EmptyState, ErrorState } from '../ui/states.js';

const parents: readonly Crumb[] = [{ label: 'Contacts', href: '/contacts' }];

/** One contact, with their company: the overview, and edit and delete. */
export function ContactPage({ id }: { readonly id: string }) {
  const { swr } = useApi();
  // The literal populate in the call is what types the company in.
  const { data, error, mutate } = useSWR(
    swr.contacts.get.key({ input: { id, populate: ['companyId'] } }),
    () => swr.contacts.get({ id, populate: ['companyId'] }),
  );
  // Before the data: SWR keeps the last data when a read fails, and a
  // deleted contact must not show as if they were there.
  if (isPFError(error) && error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        title="Contact not found"
        description="They were deleted, or belong to another organization."
        action={
          <Link
            href="/contacts"
            className={buttonVariants({ variant: 'outline' })}
          >
            Back to contacts
          </Link>
        }
      />
    );
  }
  if (data !== undefined) return <Loaded contact={data} />;
  if (error === undefined) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <ContactOverviewSkeleton />
      </>
    );
  }
  return (
    <ErrorState
      message="The contact could not be loaded."
      onRetry={() => void mutate()}
    />
  );
}

function Loaded({ contact }: { readonly contact: ContactWithCompany }) {
  const { rpc, swr } = useApi();
  const { mutate } = useSWRConfig();
  const [, navigate] = useLocation();
  const searchCompanies = useCompanySearch();
  const [editing, setEditing] = useState(false);

  const update = async (patch: ContactPatch) => {
    // Nothing changed: nothing to send.
    if (Object.keys(patch).length > 0) {
      const result = await asResult(
        rpc.contacts.update({ id: contact.id, ...patch }),
      );
      if (!result.ok) return result.error;
      toast.add({ title: `Saved ${result.data.name}`, type: 'success' });
      void mutate(swr.contacts.matcher());
    }
    setEditing(false);
    return undefined;
  };

  const remove = async () => {
    const result = await asResult(rpc.contacts.delete({ id: contact.id }));
    if (!result.ok) return result.error;
    toast.add({ title: `Deleted ${contact.name}`, type: 'success' });
    void mutate(swr.contacts.matcher());
    navigate('/contacts');
    return undefined;
  };

  return (
    <>
      <PageHeader
        title={contact.name}
        parents={parents}
        icon={<UserIcon />}
        description={contact.title}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
            <ConfirmDelete
              name={contact.name}
              consequence="Their activities and tasks are deleted with them. This cannot be undone."
              onDelete={remove}
            />
          </>
        }
      />
      <ContactOverview contact={contact} />
      <FormSheet
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${contact.name}`}
        description="Only what you change is saved."
      >
        <ContactForm
          contact={contact}
          searchCompanies={searchCompanies}
          onSubmit={update}
        />
      </FormSheet>
    </>
  );
}
