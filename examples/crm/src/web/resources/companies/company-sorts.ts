import type { SortOption } from '../../ui/list-params.js';

/** The sorts a list of companies offers, by the key the API takes. */
export const companySorts = [
  { value: 'name', label: 'Name' },
  { value: '-updatedAt', label: 'Last updated' },
] as const satisfies readonly SortOption<string>[];

export type CompanySort = (typeof companySorts)[number]['value'];

/** The sort a list of companies starts with. */
export const defaultCompanySort: CompanySort = 'name';
