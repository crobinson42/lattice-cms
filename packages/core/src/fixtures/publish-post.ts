import type { UseCase } from 'hexok';
import { z } from 'zod';
import { LatticeError } from '../errors.js';
import type { Repo } from '../index.js';
import { AppUseCase } from './context.js';
import { Posts } from './posts.js';

/** A custom method: sets a post's status through the posts repo. */
export class PublishPost extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  constructor(private readonly deps: { posts: Repo<typeof Posts> }) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<z.output<typeof Posts.output>> {
    const post = await this.deps.posts.update(input.id, {
      status: 'published',
    });
    if (post === null) {
      throw LatticeError.NOT_FOUND({ collection: Posts.slug, id: input.id });
    }
    return post;
  }
}
