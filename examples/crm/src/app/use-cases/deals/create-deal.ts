import type { CreateInput, Doc } from '@latticecms/core';
import { Deals } from '../../../domain/collections/deals.js';
import { type AppCtx, AppUseCase } from '../context.js';
import { refuseClosing } from './close-only.js';

/** Replaces deals.create: the generated create, for a deal that is not closed. */
export class CreateDeal extends AppUseCase('deals.create', {
  collection: Deals,
}) {
  constructor(
    private readonly deps: {
      create: (
        ctx: AppCtx,
        input: CreateInput<typeof Deals>,
      ) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: CreateInput<typeof Deals>,
  ): Promise<Doc<typeof Deals>> {
    refuseClosing(input);
    return this.deps.create(ctx, input);
  }
}
