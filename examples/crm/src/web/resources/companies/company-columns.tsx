import type { Column } from '../../ui/data-table.js';
import { formatRelative } from '../../ui/format.js';
import type { Company } from './company.js';
import { CompanyInline } from './company-inline.js';
import { CompanyWebsite } from './company-website.js';

/** The columns any table of companies shows, in order. */
export const companyColumns: readonly Column<Company>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (company) => <CompanyInline company={company} />,
  },
  {
    key: 'domain',
    header: 'Domain',
    cell: (company) => <CompanyWebsite company={company} />,
  },
  { key: 'industry', header: 'Industry', cell: (company) => company.industry },
  {
    key: 'updatedAt',
    header: 'Updated',
    cell: (company) => (
      <time dateTime={company.updatedAt}>
        {formatRelative(company.updatedAt)}
      </time>
    ),
  },
];
