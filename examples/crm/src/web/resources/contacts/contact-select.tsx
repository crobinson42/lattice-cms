import { type Search, SearchSelect } from '../../ui/search-select.js';
import { contactCount } from './contact.format.js';
import type { Contact } from './contact.js';

/**
 * What a pick of a contact needs: their id, their name to show, and their
 * company, for an activity's or a task's parents.
 */
export type ContactOption = Pick<Contact, 'id' | 'name' | 'companyId'>;

/**
 * Picks one contact, searched by name as the user types. `search` reads
 * them: this is a form field, and the page owns the fetching.
 */
export function ContactSelect({
  name,
  search,
  error,
  onPick,
}: {
  /** The form field it submits the id as, or none: then read `onPick`. */
  readonly name?: string;
  readonly search: Search<ContactOption>;
  readonly error: string | undefined;
  readonly onPick?: (contact: ContactOption | null) => void;
}) {
  return (
    <SearchSelect
      {...(name === undefined ? {} : { name })}
      label="Contact"
      placeholder="Search contacts"
      defaultValue={null}
      search={search}
      itemKey={({ id }) => id}
      itemLabel={({ name }) => name}
      countLabel={contactCount}
      nothingFound="No contacts found."
      error={error}
      {...(onPick === undefined ? {} : { onPick })}
    />
  );
}
