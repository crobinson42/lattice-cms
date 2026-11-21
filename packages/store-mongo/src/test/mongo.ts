import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The connection string of the test replica set. */
    mongoUrl: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

/**
 * Starts one single-node replica set for the whole run: transactions need a
 * replica set. The server version is pinned in package.json
 * (`config.mongodbMemoryServer.version`), and MONGOMS_VERSION overrides it.
 */
export async function setup(project: TestProject): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide('mongoUrl', replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
