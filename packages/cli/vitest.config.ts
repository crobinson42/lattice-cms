import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Each test spawns the built bin, tsc or vitest on a copy of an app.
    testTimeout: 60_000,
  },
});
