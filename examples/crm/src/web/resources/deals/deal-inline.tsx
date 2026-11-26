import { Link } from 'wouter';
import type { Deal } from './deal.js';

/** The deal's title, linking to its page. */
export function DealInline({
  deal,
}: {
  readonly deal: Pick<Deal, 'id' | 'title'>;
}) {
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="font-medium underline-offset-4 hover:underline"
    >
      {deal.title}
    </Link>
  );
}
