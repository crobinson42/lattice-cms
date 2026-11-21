import type { Repo } from '@latticecms/core';
import type { z } from 'zod';
import { Deals } from '../../../domain/collections/deals.js';
import { DomainError } from '../../../domain/errors/domain.js';
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
  ): Promise<z.output<typeof Deals.output>> {
    const deal = await this.deps.deals.update(input.id, { archived: true });
    // The generated delete throws Lattice's NOT_FOUND here; core does not
    // export LatticeError, so the app answers with its own code.
    if (deal === null) throw DomainError.DealNotFound({ id: input.id });
    return deal;
  }
}
