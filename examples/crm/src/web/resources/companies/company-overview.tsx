import {
  DetailList,
  DetailListSkeleton,
  PhoneLink,
} from '../../ui/detail-list.js';
import { formatDate, formatRelative } from '../../ui/format.js';
import type { Company } from './company.js';
import { CompanyWebsite } from './company-website.js';

/** A detail section: the company's own fields. */
export function CompanyOverview({ company }: { readonly company: Company }) {
  return (
    <DetailList
      label="Overview"
      details={[
        {
          label: 'Domain',
          value:
            company.domain === undefined ? undefined : (
              <CompanyWebsite company={company} />
            ),
        },
        { label: 'Industry', value: company.industry },
        {
          label: 'Phone',
          value:
            company.phone === undefined ? undefined : (
              <PhoneLink phone={company.phone} />
            ),
        },
        {
          label: 'Created',
          value: (
            <time dateTime={company.createdAt}>
              {formatDate(company.createdAt)}
            </time>
          ),
        },
        {
          label: 'Updated',
          value: (
            <time dateTime={company.updatedAt}>
              {formatRelative(company.updatedAt)}
            </time>
          ),
        },
      ]}
    />
  );
}

/** CompanyOverview's place while the company loads. */
export function CompanyOverviewSkeleton() {
  return <DetailListSkeleton rows={5} />;
}
