import type { SortOption } from '../../ui/list-params.js';

const sorts = [
  { value: '-createdAt', label: 'Newest' },
  { value: '-updatedAt', label: 'Last updated' },
  // A deal with no expected close date comes last.
  { value: 'expectedCloseDate', label: 'Closing soonest' },
  { value: '-amount', label: 'Largest amount' },
] as const satisfies readonly SortOption<string>[];

export type DealSort = (typeof sorts)[number]['value'];

/** The sort a list of deals starts with. */
export const defaultDealSort: DealSort = '-createdAt';

/**
 * The sorts a list of deals offers the signed-in member. Amount only for a
 * member who reads it: a sort on a withheld field is refused.
 */
export function dealSorts(
  readsAmounts: boolean,
): readonly SortOption<DealSort>[] {
  return readsAmounts
    ? sorts
    : sorts.filter(({ value }) => value !== '-amount');
}
