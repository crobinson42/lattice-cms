import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { builtPage } from '../test/web.js';

// Gzipped bytes, from the first build (2026-11-23) plus 5%:
// - everything the page loads, JS and CSS: 132,286 measured;
// - the JS but React's chunk, so the admin's own share: 55,564 measured.
// React 19's production build was 67,530 of the total.
const budget = { total: 138_901, withoutReact: 58_343 };

it('keeps the built admin page within its gzipped budget', async () => {
  const assets = new URL('assets/', builtPage);
  const names = await readdir(assets).catch(() => {
    throw new Error('The admin page is not built: run npm run build.');
  });
  const sizes = await Promise.all(
    names
      .filter((name) => /\.(js|css)$/.test(name))
      .map(async (name) => ({
        name,
        gzipped: gzipSync(await readFile(new URL(name, assets))).length,
      })),
  );
  const sum = (list: readonly { gzipped: number }[]) =>
    list.reduce((total, { gzipped }) => total + gzipped, 0);
  const total = sum(sizes);
  const withoutReact = sum(
    sizes.filter(
      ({ name }) => name.endsWith('.js') && !name.startsWith('react-'),
    ),
  );
  expect(total, 'gzipped bytes in all').toBeLessThanOrEqual(budget.total);
  expect(withoutReact, 'gzipped bytes without React').toBeLessThanOrEqual(
    budget.withoutReact,
  );
});
