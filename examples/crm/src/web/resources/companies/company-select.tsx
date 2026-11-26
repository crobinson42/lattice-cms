import { SearchSelect } from '../../ui/search-select.js';
import { companyCount } from './company.format.js';
import { type Company, type CompanyRef, isReadableCompany } from './company.js';

/** What a pick of a company needs: its id, and its name to show. */
export type CompanyOption = Pick<Company, 'id' | 'name'>;

/**
 * A populated company as the select's starting value. One the caller may
 * not read keeps its id, so a form that does not change it sends nothing.
 */
export function companyOption(company: CompanyRef): CompanyOption {
  return isReadableCompany(company)
    ? company
    : { id: company.id, name: 'Hidden company' };
}

/**
 * Picks one company, searched by name as the user types. `search` reads
 * them: this is a form field, and the page owns the fetching.
 */
export function CompanySelect({
  name,
  defaultValue,
  search,
  error,
}: {
  readonly name: string;
  readonly defaultValue: CompanyOption | null;
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly CompanyOption[]>;
  readonly error: string | undefined;
}) {
  return (
    <SearchSelect
      name={name}
      label="Company"
      placeholder="Search companies"
      defaultValue={defaultValue}
      search={search}
      itemKey={({ id }) => id}
      itemLabel={({ name }) => name}
      countLabel={companyCount}
      nothingFound="No companies found."
      error={error}
    />
  );
}
