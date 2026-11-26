import { type Search, SearchSelect } from '../../ui/search-select.js';
import { dealCount } from './deal.format.js';
import type { Deal } from './deal.js';

/** What a pick of a deal needs: its id, title, and company, for parents. */
export type DealOption = Pick<Deal, 'id' | 'title' | 'companyId'>;

/**
 * Picks one deal, searched by title as the user types. `search` reads
 * them: this is a form field, and the page owns the fetching.
 */
export function DealSelect({
  name,
  search,
  error,
  onPick,
}: {
  /** The form field it submits the id as, or none: then read `onPick`. */
  readonly name?: string;
  readonly search: Search<DealOption>;
  readonly error: string | undefined;
  readonly onPick?: (deal: DealOption | null) => void;
}) {
  return (
    <SearchSelect
      {...(name === undefined ? {} : { name })}
      label="Deal"
      placeholder="Search deals"
      defaultValue={null}
      search={search}
      itemKey={({ id }) => id}
      itemLabel={({ title }) => title}
      countLabel={dealCount}
      nothingFound="No deals found."
      error={error}
      {...(onPick === undefined ? {} : { onPick })}
    />
  );
}
