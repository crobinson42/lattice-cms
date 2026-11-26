import { useState } from 'react';
import type { Search } from '../ui/search-select.js';
import { SelectField } from '../ui/select-field.js';
import {
  type CompanyOption,
  CompanySelect,
} from './companies/company-select.js';
import {
  type ContactOption,
  ContactSelect,
} from './contacts/contact-select.js';
import { type DealOption, DealSelect } from './deals/deal-select.js';
import type { Parent } from './parents.js';

/** How ParentSelect reads each kind of record: the page owns the fetching. */
export type ParentSearches = {
  readonly companies: Search<CompanyOption>;
  readonly contacts: Search<ContactOption>;
  readonly deals: Search<DealOption>;
};

/** What a task can be on, in the picker's order, each with its label. */
const kinds = [
  ['company', 'Company'],
  ['contact', 'Contact'],
  ['deal', 'Deal'],
] as const satisfies readonly (readonly [Parent['on'], string])[];

/**
 * Picks the record a task is on: its kind, then the record, searched. A
 * contact or a deal is picked with its company, so the parents follow the
 * rule. `onPick` has the parent, or undefined until one is picked.
 */
export function ParentSelect({
  searches,
  error,
  onPick,
}: {
  readonly searches: ParentSearches;
  /** A refusal for a missing parent. */
  readonly error: string | undefined;
  readonly onPick: (parent: Parent | undefined) => void;
}) {
  const [kind, setKind] = useState<Parent['on']>('company');
  return (
    <>
      <SelectField
        label="Related to"
        options={kinds.map(([value, label]) => ({ value, label }))}
        defaultValue={kind}
        error={undefined}
        onChange={(value) => {
          setKind(kinds.find(([on]) => on === value)?.[0] ?? 'company');
          onPick(undefined);
        }}
      />
      {kind === 'company' ? (
        <CompanySelect
          key={kind}
          defaultValue={null}
          search={searches.companies}
          error={error}
          onPick={(company) =>
            onPick(company === null ? undefined : { on: kind, id: company.id })
          }
        />
      ) : kind === 'contact' ? (
        <ContactSelect
          key={kind}
          search={searches.contacts}
          error={error}
          onPick={(contact) =>
            onPick(
              contact === null
                ? undefined
                : { on: kind, id: contact.id, companyId: contact.companyId },
            )
          }
        />
      ) : (
        <DealSelect
          key={kind}
          search={searches.deals}
          error={error}
          onPick={(deal) =>
            onPick(
              deal === null
                ? undefined
                : { on: kind, id: deal.id, companyId: deal.companyId },
            )
          }
        />
      )}
    </>
  );
}
