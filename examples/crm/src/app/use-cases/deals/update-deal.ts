import type { Doc, UpdateInput } from '@latticecms/core';
import { Deals } from '../../../domain/collections/deals.js';
import { type AppCtx, AppUseCase } from '../context.js';
import { refuseClosing } from './close-only.js';

/**
 * Replaces deals.update: the generated update, except that it cannot close
 * the deal. A closed deal is already out of its access scope.
 */
export class UpdateDeal extends AppUseCase('deals.update', {
  collection: Deals,
}) {
  constructor(
    private readonly deps: {
      update: (
        ctx: AppCtx,
        input: UpdateInput<typeof Deals>,
      ) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: UpdateInput<typeof Deals>,
  ): Promise<Doc<typeof Deals>> {
    refuseClosing(input);
    return this.deps.update(ctx, input);
  }
}
