import { defineConfig } from 'vitest/config';

// The migrate tests need mongod, which starts once for them. They run
// after the rest, one file at a time.
const mongo = ['src/migrate.test.ts'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Each test spawns the built bin, tsc or vitest on a copy of an app.
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: { name: 'cli', include: ['src/**/*.test.ts'], exclude: mongo },
      },
      {
        extends: true,
        test: {
          name: 'mongo',
          include: mongo,
          globalSetup: ['./src/test/mongo.ts'],
          // The first run downloads mongod before the replica set starts.
          hookTimeout: 120_000,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
