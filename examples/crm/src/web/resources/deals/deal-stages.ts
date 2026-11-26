import type { Badge } from '@shadalaya/react/badge';
import type { ComponentProps } from 'react';
import type { Deal } from './deal.js';

export type DealStage = Deal['stage'];

/** How each stage reads, and its badge's look. */
export const dealStages: Readonly<
  Record<
    DealStage,
    {
      readonly label: string;
      readonly tone: ComponentProps<typeof Badge>['variant'];
    }
  >
> = {
  lead: { label: 'Lead', tone: 'outline' },
  qualified: { label: 'Qualified', tone: 'secondary' },
  proposal: { label: 'Proposal', tone: 'secondary' },
  negotiation: { label: 'Negotiation', tone: 'secondary' },
  won: { label: 'Won', tone: 'default' },
  lost: { label: 'Lost', tone: 'destructive' },
};

/** The stages of an open deal, in the pipeline's order. */
export const openStages = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
] as const satisfies readonly DealStage[];

/** Every stage: the open ones, then how a deal closes. */
export const allStages = [
  ...openStages,
  'won',
  'lost',
] as const satisfies readonly DealStage[];

/** Whether the deal is still open: it closes once, through deals.close. */
export function isOpen(deal: Pick<Deal, 'closedAt'>): boolean {
  return deal.closedAt === undefined;
}
