import type { UseCase } from 'hexok';
import type { z } from 'zod';
import { LatticeError } from '../errors.js';
import type { CollectionStore } from '../index.js';
import { AppUseCase } from './context.js';
import { Posts } from './posts.js';

/** Replaces the generated delete: the post stays in the store. */
export class ArchivePost extends AppUseCase('posts.delete', {
  collection: Posts,
}) {
  constructor(private readonly deps: { store: CollectionStore }) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<z.output<typeof Posts.output>> {
    const doc = await this.deps.store.get(Posts.slug, input.id);
    if (doc === null) {
      throw LatticeError.NOT_FOUND({ collection: Posts.slug, id: input.id });
    }
    return Posts.output.parse(doc);
  }
}
