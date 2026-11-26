import { Button } from '@shadalaya/react/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { PlusIcon, XIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { type ApiError, useApi } from '../api.js';
import { CompanyInline } from '../resources/companies/company-inline.js';
import type { ContactWithCompany } from '../resources/contacts/contact.js';
import { ContactInline } from '../resources/contacts/contact-inline.js';
import { useContactSearch } from '../resources/contacts/contact-search.js';
import { ContactSelect } from '../resources/contacts/contact-select.js';
import type { Deal } from '../resources/deals/deal.js';
import { useDealActions } from '../resources/deals/deal-actions.js';
import { DealContactRoleBadge } from '../resources/deals/deal-contact-role-badge.js';
import {
  type DealContactLink,
  dealContactRoles,
  parseRole,
  roleOptions,
  withContact,
  withoutContact,
} from '../resources/deals/deal-contact-roles.js';
import { ConfirmAction } from '../ui/confirm-action.js';
import { type Column, DataTable, DataTableSkeleton } from '../ui/data-table.js';
import { FormSheet, useFormSubmit } from '../ui/form.js';
import { Section } from '../ui/section.js';
import { SelectField } from '../ui/select-field.js';
import { EmptyState, ErrorState } from '../ui/states.js';

/** A contact on the deal: the link, and the contact with their company. */
type Row = {
  readonly id: string;
  readonly link: DealContactLink;
  readonly contact: ContactWithCompany | undefined;
};

/**
 * How a save ended: sent, refused, or refused because another tab closed
 * or archived the deal, which the page has already said and shown.
 */
type Saved = 'saved' | 'handled' | ApiError;

/** A read of `in` takes at most this many ids. */
const chunk = 100;

/**
 * The deal's contacts, through its `contacts` relation: who, at which
 * company, and their role. `set` replaces the whole list, so every change
 * sends it all: adding someone, changing a role, removing someone. One
 * change runs at a time, shown at once and undone if refused. A closed deal
 * can no longer change, so its contacts are read-only.
 */
export function DealContacts({
  deal,
  companyId,
  editable,
}: {
  readonly deal: Pick<Deal, 'id' | 'title'>;
  /** The deal's company: its contacts are offered first. */
  readonly companyId: string;
  readonly editable: boolean;
}) {
  const { rpc, swr } = useApi();
  const { changedElsewhere } = useDealActions();
  // Every link, oldest first, so a contact added goes to the end: `set`
  // needs the full list, and a deal holds up to 1000.
  const listed = { id: deal.id, sort: ['createdAt' as const], limit: 100 };
  const links = useSWR(
    swr.deals.contacts.list.key({ input: listed }),
    async () => {
      const all: DealContactLink[] = [];
      let after: string | undefined;
      do {
        const page = await swr.deals.contacts.list({
          ...listed,
          ...(after === undefined ? {} : { after }),
        });
        all.push(
          ...page.docs.map(({ contactsId, role }) => ({ contactsId, role })),
        );
        after = page.next ?? undefined;
      } while (after !== undefined);
      return all;
    },
  );
  const ids = useMemo(
    () => links.data?.map(({ contactsId }) => contactsId) ?? [],
    [links.data],
  );
  // The contacts themselves, each with their company, 100 at a time. The
  // last names stay while a change reads them again.
  const where = { id: { in: ids } };
  const contacts = useSWR(
    ids.length === 0
      ? null
      : swr.contacts.find.key({
          input: { where, limit: chunk, populate: ['companyId'] },
        }),
    async () => {
      const found: ContactWithCompany[] = [];
      for (let at = 0; at < ids.length; at += chunk) {
        const { docs } = await swr.contacts.find({
          where: { id: { in: ids.slice(at, at + chunk) } },
          limit: chunk,
          populate: ['companyId'],
        });
        found.push(...docs);
      }
      return found;
    },
    { keepPreviousData: true },
  );

  const [saving, setSaving] = useState(false);
  /**
   * Sends the list `change` makes of the current one. Shown before it is
   * sent, unless `shown` is 'after': a remove keeps its row, and its
   * dialog, until it is done.
   */
  const save = async (
    change: (current: readonly DealContactLink[]) => DealContactLink[],
    shown: 'before' | 'after' = 'before',
  ): Promise<Saved> => {
    const outcome: { refused?: ApiError } = {};
    setSaving(true);
    try {
      await links.mutate(
        async (current) => {
          const next = change(current ?? []);
          const result = await asResult(
            rpc.deals.contacts.set({ id: deal.id, links: next }),
          );
          if (!result.ok) {
            outcome.refused = result.error;
            throw result.error;
          }
          return next;
        },
        {
          ...(shown === 'before'
            ? {
                optimisticData: (current?: DealContactLink[]) =>
                  change(current ?? []),
              }
            : {}),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch {
      // Rolled back: `outcome.refused` says why.
    } finally {
      setSaving(false);
    }
    if (outcome.refused === undefined) return 'saved';
    return changedElsewhere(deal, outcome.refused)
      ? 'handled'
      : outcome.refused;
  };

  const [adding, setAdding] = useState(false);
  // Where focus goes after a remove: the row and its button are gone.
  const add = useRef<HTMLButtonElement>(null);
  const addContact = (
    <Button
      ref={add}
      variant="outline"
      size="sm"
      disabled={saving}
      onClick={() => setAdding(true)}
    >
      <PlusIcon />
      Add contact
    </Button>
  );

  const rows = links.data?.map(
    (link): Row => ({
      id: link.contactsId,
      link,
      contact: contacts.data?.find(({ id }) => id === link.contactsId),
    }),
  );
  const nameOf = (row: Row) => row.contact?.name ?? 'This contact';
  const columns: readonly Column<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) =>
        row.contact === undefined ? null : (
          <ContactInline contact={row.contact} />
        ),
    },
    {
      key: 'company',
      header: 'Company',
      cell: (row) =>
        row.contact === undefined ? null : (
          <CompanyInline company={row.contact.companyId} />
        ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) =>
        editable ? (
          <NativeSelect
            size="sm"
            aria-label={`Role of ${nameOf(row)}`}
            value={row.link.role}
            disabled={saving}
            onChange={async (event) => {
              const role = parseRole(event.target.value);
              const saved = await save((current) =>
                withContact(current, { contactsId: row.link.contactsId, role }),
              );
              if (saved !== 'saved' && saved !== 'handled') {
                toast.add({ title: saved.message, type: 'error' });
              }
            }}
          >
            {roleOptions.map(({ value, label }) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <DealContactRoleBadge role={row.link.role} />
        ),
    },
    ...(editable
      ? [
          {
            key: 'remove',
            header: 'Actions',
            cell: (row: Row) => (
              <ConfirmAction
                trigger={
                  <>
                    <XIcon />
                    Remove
                  </>
                }
                variant="outline"
                title={`Remove ${nameOf(row)} from ${deal.title}?`}
                description="They stay a contact. Only their place on this deal goes."
                confirm="Remove"
                pending="Removing…"
                onConfirm={async () => {
                  const saved = await save(
                    (current) => withoutContact(current, row.link.contactsId),
                    'after',
                  );
                  // The row, its button and the dialog go with it, and the
                  // dialog's focus manager hands focus back as it unmounts:
                  // move it once that frame is done.
                  if (saved === 'saved') {
                    requestAnimationFrame(() => add.current?.focus());
                  }
                  return saved === 'saved' || saved === 'handled'
                    ? undefined
                    : saved.message;
                }}
              />
            ),
          },
        ]
      : []),
  ];

  const label = `Contacts on ${deal.title}`;
  return (
    <Section
      id="contacts"
      title="Contacts"
      action={editable ? addContact : undefined}
    >
      {rows === undefined ? (
        links.error === undefined ? (
          <DataTableSkeleton label={label} columns={columns} rows={2} />
        ) : (
          <ErrorState
            message="The deal's contacts could not be loaded."
            onRetry={() => void links.mutate()}
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          title="No contacts on this deal"
          {...(editable
            ? { description: 'Add the people you are working this deal with.' }
            : {})}
        />
      ) : (
        <DataTable
          label={label}
          columns={columns}
          rows={rows}
          rowKey={({ id }) => id}
        />
      )}
      <FormSheet
        open={adding}
        onOpenChange={setAdding}
        title={`Add a contact to ${deal.title}`}
        description="Pick someone, and what they are to this deal."
      >
        <AddContactForm
          companyId={companyId}
          onDeal={ids}
          onAdd={async (link) => {
            const saved = await save((current) => withContact(current, link));
            if (saved === 'saved' || saved === 'handled') setAdding(false);
            if (saved === 'saved') {
              toast.add({
                title: `Added as ${dealContactRoles[link.role].toLowerCase()}`,
                type: 'success',
              });
            }
            return saved === 'saved' || saved === 'handled' ? undefined : saved;
          }}
        />
      </FormSheet>
    </Section>
  );
}

/**
 * A contact and their role. The contacts offered first are those at the
 * deal's company, and those already on the deal are not offered.
 */
function AddContactForm({
  companyId,
  onDeal,
  onAdd,
}: {
  readonly companyId: string;
  readonly onDeal: readonly string[];
  readonly onAdd: (link: DealContactLink) => Promise<ApiError | undefined>;
}) {
  const search = useContactSearch(companyId, onDeal);
  const { errors, pending, onSubmit } = useFormSubmit(
    ['contactsId', 'role'],
    (values) =>
      onAdd({
        contactsId: values('contactsId'),
        role: parseRole(values('role')),
      }),
  );
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      <ContactSelect
        name="contactsId"
        search={search}
        error={errors.fields.contactsId}
      />
      <SelectField
        name="role"
        label="Role"
        options={roleOptions}
        defaultValue="other"
        error={errors.fields.role}
      />
      {errors.form === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        Add contact
      </Button>
    </form>
  );
}
