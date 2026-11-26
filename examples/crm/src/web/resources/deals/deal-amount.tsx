import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shadalaya/react/tooltip';
import { formatMoney } from '../../ui/format.js';
import type { Deal } from './deal.js';

/**
 * The deal's amount, in money. Every deal has one, so a deal without it is
 * one the caller may not read: "Withheld", and why.
 */
export function DealAmount({ deal }: { readonly deal: Pick<Deal, 'amount'> }) {
  if (deal.amount !== undefined) return formatMoney(deal.amount);
  return (
    <Tooltip>
      {/* A button, so the keyboard reaches it and reads the reason. */}
      <TooltipTrigger className="text-muted-foreground underline decoration-dotted underline-offset-4">
        Withheld
      </TooltipTrigger>
      <TooltipContent>Only managers see amounts</TooltipContent>
    </Tooltip>
  );
}
