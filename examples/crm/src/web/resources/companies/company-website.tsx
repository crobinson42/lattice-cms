import { ExternalLinkIcon } from 'lucide-react';
import { websiteUrl } from './company.format.js';
import type { Company } from './company.js';

/** The company's domain, opening its website in a new tab. */
export function CompanyWebsite({
  company,
}: {
  readonly company: Pick<Company, 'domain'>;
}) {
  if (company.domain === undefined) return null;
  return (
    <a
      href={websiteUrl(company.domain)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
    >
      {company.domain}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}
