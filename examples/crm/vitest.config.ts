import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    globalSetup: ['./src/test/mongo.ts'],
    // The first run downloads mongod before the replica set starts.
    hookTimeout: 120_000,
  },
});
