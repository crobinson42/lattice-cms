// What tracing costs with no OpenTelemetry SDK registered: 10,000 `get`
// calls through createLocalClient on MemoryStore, timed over several
// rounds. Run it on two builds to compare them:
//
//   npm run build -w @latticecms/core && node packages/core/bench/get.mjs
import { NoopLogger } from '@hexok/logger';
import {
  collection,
  family,
  framework,
  MemoryStore,
  unscoped,
} from '@latticecms/core';
import { createLocalClient } from '@ts-pf/server';
import { z } from 'zod';

const calls = 10_000;
const rounds = 7;

const Family = family({
  actor: z.object({ userId: z.string() }),
  actorId: (actor) => actor.userId,
});
const Notes = collection('notes', { schema: z.object({ title: z.string() }) });
const built = framework({ family: Family })
  .collection(Notes, {
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
  })
  .build({ store: new MemoryStore(), events: { async publish() {} } });
const note = await built.repos.notes.insert({ title: 't' }, unscoped);
const local = createLocalClient(built.app, {
  context: { actor: { userId: 'u' }, logger: new NoopLogger() },
});

async function round() {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) await local.notes.get({ id: note.id });
  return performance.now() - started;
}

await round(); // warm-up: JIT and caches
const times = [];
for (let i = 0; i < rounds; i += 1) times.push(await round());
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(
  JSON.stringify({
    calls,
    rounds,
    medianMs: Math.round(median),
    minMs: Math.round(times[0]),
    maxMs: Math.round(times.at(-1)),
    usPerCall: Math.round((median / calls) * 1000 * 100) / 100,
  }),
);
