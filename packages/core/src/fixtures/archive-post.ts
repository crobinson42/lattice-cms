import type { UseCase } from 'hexok';
import type { z } from 'zod';
import { AppUseCase } from './context.js';
import { Posts } from './posts.js';

export class ArchivePost extends AppUseCase('posts.delete', {
  collection: Posts,
}) {
  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    _input: { id: string },
  ): Promise<z.output<typeof Posts.output>> {
    throw new Error('todo');
  }
}
