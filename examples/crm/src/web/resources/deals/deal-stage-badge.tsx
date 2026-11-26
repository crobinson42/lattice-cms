import { Badge } from '@shadalaya/react/badge';
import type { DealStage } from './deal-stages.js';
import { dealStages } from './deal-stages.js';

/** The deal's stage, as a badge. */
export function DealStageBadge({ stage }: { readonly stage: DealStage }) {
  const { label, tone } = dealStages[stage];
  return <Badge variant={tone}>{label}</Badge>;
}
