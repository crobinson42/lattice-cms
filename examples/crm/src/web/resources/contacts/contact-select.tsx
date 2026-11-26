import { SearchSelect } from '../../ui/search-select.js';
import { contactCount } from './contact.format.js';
import type { Contact } from './contact.js';

/** What a pick of a contact needs: their id, and their name to show. */
export type ContactOption = Pick<Contact, 'id' | 'name'>;

/**
 * Picks one contact, searched by name as the user types. `search` reads
 * them: this is a form field, and the page owns the fetching.
 */
export function ContactSelect({
  name,
  search,
  error,
}: {
  readonly name: string;
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly ContactOption[]>;
  readonly error: string | undefined;
}) {
  return (
    <SearchSelect
      name={name}
      label="Contact"
      placeholder="Search contacts"
      defaultValue={null}
      search={search}
      itemKey={({ id }) => id}
      itemLabel={({ name }) => name}
      countLabel={contactCount}
      nothingFound="No contacts found."
      error={error}
    />
  );
}
