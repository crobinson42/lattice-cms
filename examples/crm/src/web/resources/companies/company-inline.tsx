import { Link } from 'wouter';
import type { Company } from './company.js';

/** The company's name, linking to its page. */
export function CompanyInline({
  company,
}: {
  readonly company: Pick<Company, 'id' | 'name'>;
}) {
  return (
    <Link
      href={`/companies/${company.id}`}
      className="font-medium underline-offset-4 hover:underline"
    >
      {company.name}
    </Link>
  );
}
