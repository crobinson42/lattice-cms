import type { Column } from '../../ui/data-table.js';
import { RelativeTime } from '../../ui/relative-time.js';

import { CompanyInline } from '../companies/company-inline.js';
import type { Contact, ContactWithCompany } from './contact.js';
import { ContactEmail } from './contact-email.js';
import { ContactInline } from './contact-inline.js';

type Basics = Pick<Contact, 'id' | 'name' | 'title' | 'email' | 'updatedAt'>;

const name: Column<Basics> = {
  key: 'name',
  header: 'Name',
  cell: (contact) => <ContactInline contact={contact} />,
};
const title: Column<Basics> = {
  key: 'title',
  header: 'Title',
  cell: (contact) => contact.title,
};
const email: Column<Basics> = {
  key: 'email',
  header: 'Email',
  cell: (contact) => <ContactEmail contact={contact} />,
};
const updated: Column<Basics> = {
  key: 'updatedAt',
  header: 'Updated',
  cell: (contact) => <RelativeTime iso={contact.updatedAt} />,
};

/** The columns any table of contacts shows, read with their company. */
export const contactColumns: readonly Column<ContactWithCompany>[] = [
  name,
  title,
  {
    key: 'company',
    header: 'Company',
    cell: (contact) => <CompanyInline company={contact.companyId} />,
  },
  email,
  updated,
];

/** The columns of a company's own contacts: the company goes without saying. */
export const companyContactColumns: readonly Column<Basics>[] = [
  name,
  title,
  email,
  updated,
];
