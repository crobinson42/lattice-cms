import type { Contact } from './contact.js';

/** The contact's email address, opening a new email to it. */
export function ContactEmail({
  contact,
}: {
  readonly contact: Pick<Contact, 'email'>;
}) {
  return (
    <a
      href={`mailto:${contact.email}`}
      className="underline-offset-4 hover:underline"
    >
      {contact.email}
    </a>
  );
}
