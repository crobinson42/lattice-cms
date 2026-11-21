import type { UseCase } from 'hexok';
import type { z } from 'zod';
import { LatticeError } from '../errors.js';
import type { Repo } from '../index.js';
import { AppUseCase } from './context.js';
import { Posts } from './posts.js';

/** Replaces the generated delete: the post stays in the store. */
export class ArchivePost extends AppUseCase('posts.delete', {
  collection: Posts,
}) {
  constructor(private readonly deps: { posts: Repo<typeof Posts> }) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<z.output<typeof Posts.output>> {
    const post = await this.deps.posts.get(
      input.id,
      await ctx.access.scope(Posts, 'delete'),
    );
    if (post === null) {
      throw LatticeError.NOT_FOUND({ collection: Posts.slug, id: input.id });
    }
    return post;
  }
}
