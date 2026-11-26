import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { builtPage } from '../test/web.js';

// The built page, as the browser gets it. What the app loads at startup is
// what index.html names: its script, its stylesheet and the chunks it
// preloads. Everything else loads later: the admin, with its stylesheet,
// when /admin first opens.

/** Gzipped bytes: the measurement of 2026-11-26, plus 5%. */
const budget = {
  startup: 170_900,
  startupWithoutReact: 99_960,
  admin: 25_420,
};

const assets = new URL('assets/', builtPage);

/** Each built JS and CSS file, gzipped, and whether startup loads it. */
async function built() {
  const names = await readdir(assets).catch(() => {
    throw new Error('The web page is not built: run npm run build.');
  });
  const html = await readFile(new URL('index.html', builtPage), 'utf8');
  const startup = new Set(
    [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].flatMap(
      ([, name]) => (name === undefined ? [] : [name]),
    ),
  );
  const files = await Promise.all(
    names
      .filter((name) => /\.(js|css)$/.test(name))
      .map(async (name) => {
        const text = await readFile(new URL(name, assets), 'utf8');
        return { name, text, gzipped: gzipSync(text).length };
      }),
  );
  return {
    files,
    startup: files.filter(({ name }) => startup.has(name)),
    later: files.filter(({ name }) => !startup.has(name)),
  };
}

const sum = (list: readonly { gzipped: number }[]) =>
  list.reduce((total, { gzipped }) => total + gzipped, 0);

it('keeps the app at startup and the admin chunk within budget', async () => {
  const { startup, later } = await built();
  const withoutReact = startup.filter(({ name }) => !name.startsWith('react-'));
  console.log(
    `web page, gzipped: startup ${sum(startup)} B (without React ${sum(
      withoutReact,
    )} B), admin chunk ${sum(later)} B`,
  );
  expect(sum(startup)).toBeLessThanOrEqual(budget.startup);
  expect(sum(withoutReact)).toBeLessThanOrEqual(budget.startupWithoutReact);
  expect(sum(later)).toBeLessThanOrEqual(budget.admin);
});

it('loads the admin and its stylesheet only after startup', async () => {
  const { startup, later } = await built();
  // Text only the admin's own components hold.
  const admin = 'Apply filters';
  const source = await readFile(
    new URL('../../../../packages/admin/src/filters.tsx', import.meta.url),
    'utf8',
  );
  expect(source, 'the admin still says it').toContain(admin);
  if (!later.some(({ text }) => text.includes(admin))) {
    throw new Error(
      'No file that loads after startup holds the admin: is it still lazy?',
    );
  }
  expect(startup.filter(({ text }) => text.includes(admin))).toEqual([]);
  expect(later.some(({ name }) => name.endsWith('.css'))).toBe(true);
});

it('carries no server code', async () => {
  // Strings only server modules hold: the session store's key prefix, the
  // store's missing-setting message, a domain error, and a method's summary.
  // The page imports the contracts by type only, and headers.ts, which
  // holds only a header's name, so none should appear.
  const server = {
    'crm:session:': '../infra/auth/sessions.ts',
    'Set MONGODB_URL': '../infra/store.ts',
    'The deal is already closed': '../domain/errors/domain.ts',
    'Log a note, call, email or meeting':
      '../app/use-cases/activities/log-activity.ts',
  };
  for (const [needle, file] of Object.entries(server)) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    expect(source, `${file} still holds it`).toContain(needle);
  }
  for (const { name, text } of (await built()).files) {
    for (const found of Object.keys(server).filter((needle) =>
      text.includes(needle),
    )) {
      throw new Error(`${name} holds server code: "${found}"`);
    }
  }
});
