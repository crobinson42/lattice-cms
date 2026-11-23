import { defineConfig } from 'vitest/config';

// The files that start a real server on MongoStore. Each start creates every
// collection's indexes, and mongod builds only a few indexes at once, so
// starts that overlap wait on each other and on every other MongoDB test.
// They run after the rest, one file at a time.
const servers = [
  'src/servers/http/server.test.ts',
  'src/servers/http/tracing.test.ts',
  'src/web/admin.browser.test.ts',
];

export default defineConfig({
  test: {
    passWithNoTests: true,
    globalSetup: ['./src/test/mongo.ts'],
    // The first run downloads mongod before the replica set starts.
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: { name: 'crm', include: ['src/**/*.test.ts'], exclude: servers },
      },
      {
        extends: true,
        test: {
          name: 'servers',
          include: servers,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
