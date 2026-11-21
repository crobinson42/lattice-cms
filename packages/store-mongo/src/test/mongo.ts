import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The connection string of the test replica set. */
    mongoUrl: string;
    /** The connection string of a standalone server, which has no transactions. */
    standaloneUrl: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;
let standalone: MongoMemoryServer | undefined;

/**
 * Starts the run's servers, one after the other: a single-node replica set,
 * because transactions need one, and a standalone server for the cases that
 * run without them. Test files run in parallel workers, so a server each
 * file started itself could race another for a free port. The server version
 * is pinned in package.json (`config.mongodbMemoryServer.version`), and
 * MONGOMS_VERSION overrides it.
 */
export async function setup(project: TestProject): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  standalone = await MongoMemoryServer.create();
  project.provide('mongoUrl', replSet.getUri());
  project.provide('standaloneUrl', standalone.getUri());
}

export async function teardown(): Promise<void> {
  await standalone?.stop();
  await replSet?.stop();
}
