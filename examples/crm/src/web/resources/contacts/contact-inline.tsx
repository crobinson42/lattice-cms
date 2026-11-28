import { Link } from 'wouter';
import type { Contact } from './contact.js';

/** The contact's name, linking to their page. */
export function ContactInline({
  contact,
}: {
  readonly contact: Pick<Contact, 'id' | 'name'>;
}) {
  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="font-medium underline-offset-4 hover:underline"
    >
      {contact.name}
    </Link>
  );
}
