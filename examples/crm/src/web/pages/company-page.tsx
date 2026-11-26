import { Button, buttonVariants } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { isPFError } from '@ts-pf/protocol';
import { Building2Icon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Link, useLocation } from 'wouter';
import { useApi } from '../api.js';
import type { Company, CompanyPatch } from '../resources/companies/company.js';
import { CompanyForm } from '../resources/companies/company-form.js';
import {
  CompanyOverview,
  CompanyOverviewSkeleton,
} from '../resources/companies/company-overview.js';
import { ConfirmDelete } from '../ui/confirm-delete.js';
import { FormSheet } from '../ui/form.js';
import { PageHeader } from '../ui/page-header.js';
import type { Crumb } from '../ui/shell.js';
import { EmptyState, ErrorState } from '../ui/states.js';

const parents: readonly Crumb[] = [{ label: 'Companies', href: '/companies' }];

/** One company: its overview, and edit and delete. */
export function CompanyPage({ id }: { readonly id: string }) {
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
  const { mutate } = useSWRConfig();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);

  const update = async (patch: CompanyPatch) => {
    // Nothing changed: nothing to send.
    if (Object.keys(patch).length > 0) {
      const result = await asResult(
        rpc.companies.update({ id: company.id, ...patch }),
      );
      if (!result.ok) return result.error;
      toast.add({ title: `Saved ${result.data.name}`, type: 'success' });
      void mutate(swr.companies.matcher());
    }
    setEditing(false);
    return undefined;
  };

  const remove = async () => {
    const result = await asResult(rpc.companies.delete({ id: company.id }));
    if (!result.ok) return result.error;
    toast.add({ title: `Deleted ${company.name}`, type: 'success' });
    void mutate(swr.companies.matcher());
    navigate('/companies');
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
