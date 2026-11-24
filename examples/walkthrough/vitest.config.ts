import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // npm install, a TypeScript build, a Vite build and a server, before
    // the browser opens.
    hookTimeout: 300_000,
    testTimeout: 120_000,
  },
});
