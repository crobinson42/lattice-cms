import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'happy-dom',
    // The page's origin, so the catalog's relative prefix resolves as it
    // does in a browser.
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
  },
});
