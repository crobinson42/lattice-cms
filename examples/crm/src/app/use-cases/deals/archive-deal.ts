import { type Doc, LatticeError, type Repo } from '@latticecms/core';
import { Deals } from '../../../domain/collections/deals.js';
import { type AppCtx, AppUseCase } from '../context.js';

/** Replaces deals.delete: the deal is archived, and the row stays. */
export class ArchiveDeal extends AppUseCase('deals.delete', {
  collection: Deals,
}) {
  constructor(private readonly deps: { deals: Repo<typeof Deals> }) {
    super();
  }

  async execute(
    _ctx: AppCtx,
    input: { id: string },
  ): Promise<Doc<typeof Deals>> {
    const deal = await this.deps.deals.update(input.id, { archived: true });
    // The same refusal the generated delete gives for a missing id.
    if (deal === null) {
      throw LatticeError.NOT_FOUND({ collection: Deals.slug, id: input.id });
    }
    return deal;
  }
}
