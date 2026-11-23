// The quick start in @latticecms/core's README, kept here so it compiles,
// runs and matches: quickstart.test.ts runs it, and readme-quotes.test.ts
// compares the README's copy with this file.
import { NoopLogger } from '@hexok/logger';
import { collection, family, framework, MemoryStore } from '@latticecms/core';
import { createLocalClient } from '@ts-pf/server';
import { z } from 'zod';

const Notes = collection('notes', {
  schema: z.object({
    title: z.string().min(1),
    done: z.boolean().default(false),
  }),
});

const AppUseCase = family({
  actor: z.object({ userId: z.string() }),
  actorId: (actor) => actor.userId,
});

const { app } = framework({ family: AppUseCase })
  .collection(Notes, {
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
  })
  .build({
    store: new MemoryStore(),
    // Where collection events go: nowhere, here.
    events: { async publish(_event: { readonly payload: unknown }) {} },
  });

const client = createLocalClient(app, {
  context: { actor: { userId: 'ann' }, logger: new NoopLogger() },
});
const note = await client.notes.create({ title: 'Write the docs' });
await client.notes.update({ id: note.id, done: true });
const { docs } = await client.notes.find({ where: { done: { eq: true } } });
console.log(docs.map((doc) => doc.title));
