import { Skeleton } from '@shadalaya/react/skeleton';
import type { ReactNode } from 'react';
import { formatDate, formatRelative } from '../../ui/format.js';
import type { Company } from './company.js';
import { CompanyWebsite } from './company-website.js';

/** A detail section: the company's own fields. */
export function CompanyOverview({ company }: { readonly company: Company }) {
  const rows: readonly (readonly [string, ReactNode])[] = [
    ['Domain', <CompanyWebsite key="domain" company={company} />],
    ['Industry', company.industry],
    [
      'Phone',
      company.phone === undefined ? undefined : (
        <a key="phone" href={`tel:${company.phone}`}>
          {company.phone}
        </a>
      ),
    ],
    [
      'Created',
      <time key="created" dateTime={company.createdAt}>
        {formatDate(company.createdAt)}
      </time>,
    ],
    [
      'Updated',
      <time key="updated" dateTime={company.updatedAt}>
        {formatRelative(company.updatedAt)}
      </time>,
    ],
  ];
  return (
    <section aria-label="Overview" className="rounded-lg border p-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** CompanyOverview's place while the company loads. */
export function CompanyOverviewSkeleton() {
  return (
    <section aria-busy className="rounded-lg border p-4">
      <div className="grid gap-2">
        {['domain', 'industry', 'phone', 'created', 'updated'].map((row) => (
          <Skeleton key={row} className="h-4 w-64" />
        ))}
      </div>
    </section>
  );
}
