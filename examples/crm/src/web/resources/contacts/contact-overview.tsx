import {
  DetailList,
  DetailListSkeleton,
  PhoneLink,
} from '../../ui/detail-list.js';
import { formatDate, formatRelative } from '../../ui/format.js';
import { CompanyInline } from '../companies/company-inline.js';
import type { ContactWithCompany } from './contact.js';
import { ContactEmail } from './contact-email.js';

/** A detail section: the contact's own fields, and their company. */
export function ContactOverview({
  contact,
}: {
  readonly contact: ContactWithCompany;
}) {
  return (
    <DetailList
      label="Overview"
      details={[
        {
          label: 'Company',
          value: <CompanyInline company={contact.companyId} />,
        },
        { label: 'Title', value: contact.title },
        { label: 'Email', value: <ContactEmail contact={contact} /> },
        {
          label: 'Phone',
          value:
            contact.phone === undefined ? undefined : (
              <PhoneLink phone={contact.phone} />
            ),
        },
        {
          label: 'Created',
          value: (
            <time dateTime={contact.createdAt}>
              {formatDate(contact.createdAt)}
            </time>
          ),
        },
        {
          label: 'Updated',
          value: (
            <time dateTime={contact.updatedAt}>
              {formatRelative(contact.updatedAt)}
            </time>
          ),
        },
      ]}
    />
  );
}

/** ContactOverview's place while the contact loads. */
export function ContactOverviewSkeleton() {
  return <DetailListSkeleton rows={6} />;
}
