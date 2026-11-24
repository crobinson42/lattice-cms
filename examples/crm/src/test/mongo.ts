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
 * `start()`, again when the port it picked was taken. Each package's test
 * run picks a free port and mongod binds it a moment later, so runs that
 * start together, as turbo starts them, can pick the same one.
 */
async function retried<T>(start: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await start();
    } catch (error) {
      const taken =
        error instanceof Error && error.message.includes('already in use');
      if (!taken || attempt === 3) throw error;
    }
  }
}

/**
 * Starts one single-node replica set for the whole run, as production runs
 * one: deleting a company runs in a transaction. The server version is
 * pinned in package.json (`config.mongodbMemoryServer.version`).
 */
export async function setup(project: TestProject): Promise<void> {
  replSet = await retried(() =>
    MongoMemoryReplSet.create({ replSet: { count: 1 } }),
  );
  project.provide('mongoUrl', replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
