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
 * Starts one single-node replica set for the whole run, as production runs
 * one: deleting a company runs in a transaction. The server version is
 * pinned in package.json (`config.mongodbMemoryServer.version`).
 */
export async function setup(project: TestProject): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide('mongoUrl', replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
