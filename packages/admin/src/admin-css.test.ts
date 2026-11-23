import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = dirname(fileURLToPath(import.meta.url));

/** The shadalaya components the admin's sources import. */
function imported(): string[] {
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .flatMap((file) =>
      [
        ...readFileSync(join(src, file), 'utf8').matchAll(
          /from '@shadalaya\/react\/([a-z-]+)'/g,
        ),
      ].flatMap(([, name]) => (name === undefined ? [] : [name])),
    );
}

it('builds admin.css over every shadalaya component the admin uses', () => {
  const css = readFileSync(join(src, 'admin.css'), 'utf8');
  const source = /@source "([^"]*)\/\{([^}]*)\}\.js";/.exec(css);
  if (source === null) throw new Error('admin.css lists no components');
  const [, directory = '', list = ''] = source;
  const components = join(src, directory);

  // The admin's imports, and the components they import in turn.
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
