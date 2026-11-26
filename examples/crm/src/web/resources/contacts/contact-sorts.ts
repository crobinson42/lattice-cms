import type { SortOption } from '../../ui/list-params.js';

/** The sorts a list of contacts offers, by the key the API takes. */
export const contactSorts = [
  { value: 'name', label: 'Name' },
  { value: '-updatedAt', label: 'Last updated' },
] as const satisfies readonly SortOption<string>[];

export type ContactSort = (typeof contactSorts)[number]['value'];

/** The sort a list of contacts starts with. */
export const defaultContactSort: ContactSort = 'name';
