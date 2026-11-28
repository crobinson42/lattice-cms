import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const web = dirname(fileURLToPath(import.meta.url));

/** The shadalaya components the app's sources import. */
function imported(): string[] {
  return readdirSync(web, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .flatMap((file) =>
      [
        ...readFileSync(join(web, file), 'utf8').matchAll(
          /from '@shadalaya\/react\/([a-z-]+)'/g,
        ),
      ].flatMap(([, name]) => (name === undefined ? [] : [name])),
    );
}

// The same check as the admin's admin-css.test.ts, over the app's sources.
it('builds app.css over every shadalaya component the app uses', () => {
  const css = readFileSync(join(web, 'app.css'), 'utf8');
  const source = /@source "([^"]*)\/\{([^}]*)\}\.js";/.exec(css);
  if (source === null) throw new Error('app.css lists no components');
  const [, directory = '', list = ''] = source;
  const components = join(web, directory);

  const used = new Set<string>();
  const pending = imported();
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (used.has(name)) continue;
    used.add(name);
    const file = join(components, `${name}.js`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    for (const [, next] of readFileSync(file, 'utf8').matchAll(
      /from "\.\/([a-z-]+)\.js"/g,
    )) {
      if (next !== undefined) pending.push(next);
    }
  }

  expect(list.split(',')).toEqual([...used].sort());
});
