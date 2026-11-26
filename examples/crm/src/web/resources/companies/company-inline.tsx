import { Link } from 'wouter';
import { type CompanyRef, isReadable } from './company.js';

/**
 * The company's name, linking to its page. A populated company the caller
 * may not read arrives as `{ id }` only, and shows as hidden.
 */
export function CompanyInline({ company }: { readonly company: CompanyRef }) {
  if (!isReadable(company)) {
    return <span className="text-muted-foreground">Hidden company</span>;
  }
  return (
    <Link
      href={`/companies/${company.id}`}
      className="font-medium underline-offset-4 hover:underline"
    >
      {company.name}
    </Link>
  );
}
