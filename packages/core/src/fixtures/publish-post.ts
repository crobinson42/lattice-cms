import type { UseCase } from 'hexok';
import { z } from 'zod';
import { AppUseCase } from './context.js';
import { Posts } from './posts.js';

export class PublishPost extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  constructor(private readonly deps: { now: () => string }) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    _input: { id: string },
  ): Promise<z.output<typeof Posts.output>> {
    throw new Error(`todo: publish at ${this.deps.now()}`);
  }
}
