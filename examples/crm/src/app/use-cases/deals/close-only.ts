import { LatticeError, type UpdateInput } from '@latticecms/core';
import type { Deals } from '../../../domain/collections/deals.js';

/**
 * A deal closes only through deals.close, which closes it once and
 * publishes DealClosed. So create and update refuse a won or lost stage,
 * and any closedAt, before they write. Typed from the deal's update input,
 * which create's input also fits, so a renamed field or stage breaks the
 * build here.
 */
export function refuseClosing(
  input: Pick<UpdateInput<typeof Deals>, 'stage' | 'closedAt'>,
): void {
  const issues = [
    ...(input.stage === 'won' || input.stage === 'lost'
      ? [{ path: ['stage'], message: 'Close a deal with deals.close' }]
      : []),
    ...(input.closedAt === undefined
      ? []
      : [{ path: ['closedAt'], message: 'deals.close sets closedAt' }]),
  ];
  if (issues.length > 0) throw LatticeError.VALIDATION({ issues });
}
