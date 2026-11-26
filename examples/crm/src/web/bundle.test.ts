import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { builtPage } from '../test/web.js';

// The built page, as the browser gets it, read from Vite's manifest. What
// the app loads at startup is index.html's entry: its script, its
// stylesheet and the chunks it imports. Each page is a chunk that loads
// when it first opens, with what it imports beyond startup: that is what
// opening it costs. The admin is one of them, with its own stylesheet.

/**
 * Gzipped bytes: the measurement of 2026-11-26, plus 5%.
 * - Startup holds React, the shell, sign-in, the session and the API, and
 *   Base UI's shared chunk, which the sidebar's sheet and the menus use.
 * - The largest page is a company's: the contact form and its combobox
 *   come with it, for the company's contacts section.
 * - The admin loads the alert dialog and the table with it, now that no
 *   page at startup does.
 */
const budget = {
  startup: 187_900,
  startupWithoutReact: 117_000,
  page: 27_400,
  admin: 26_800,
};

type Chunk = {
  readonly file: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly css?: readonly string[];
};

async function manifest(): Promise<Record<string, Chunk>> {
  const text = await readFile(
    new URL('.vite/manifest.json', builtPage),
    'utf8',
  ).catch(() => {
    throw new Error('The web page is not built: run npm run build.');
  });
  return JSON.parse(text);
}

/** The files a chunk loads: its own, its stylesheets and its imports'. */
function filesOf(chunks: Record<string, Chunk>, key: string): Set<string> {
  const files = new Set<string>();
  const visit = (at: string) => {
    const chunk = chunks[at];
    if (chunk === undefined || files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const next of chunk.imports ?? []) visit(next);
  };
  visit(key);
  return files;
}

const cache = new Map<string, { text: string; gzipped: number }>();
async function read(file: string) {
  const known = cache.get(file);
  if (known !== undefined) return known;
  const text = await readFile(new URL(file, builtPage), 'utf8');
  const read = { text, gzipped: gzipSync(text).length };
  cache.set(file, read);
  return read;
}

async function size(files: Iterable<string>): Promise<number> {
  let total = 0;
  for (const file of files) total += (await read(file)).gzipped;
  return total;
}

/** Startup's files, and each page's files beyond startup, by its source. */
async function built() {
  const chunks = await manifest();
  const entry = Object.entries(chunks).find(([, chunk]) => chunk.isEntry);
  if (entry === undefined) throw new Error('The manifest has no entry.');
  const startup = filesOf(chunks, entry[0]);
  const pages = Object.entries(chunks)
    .filter(([, chunk]) => chunk.isDynamicEntry)
    .map(([source]) => ({
      source,
      files: [...filesOf(chunks, source)].filter((file) => !startup.has(file)),
    }));
  return { startup, pages };
}

it('keeps startup, each page and the admin within budget', async () => {
  const { startup, pages } = await built();
  // What index.html names is what startup loads, and nothing else.
  const html = await readFile(new URL('index.html', builtPage), 'utf8');
  const named = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(
    ([, file]) => file,
  );
  expect(new Set(named)).toEqual(startup);

  const sizes = await Promise.all(
    pages.map(async ({ source, files }) => ({
      source,
      gzipped: await size(files),
    })),
  );
  const admin = sizes.find(({ source }) => source.endsWith('admin-page.tsx'));
  if (admin === undefined) throw new Error('The admin is not a page chunk.');
  const others = sizes.filter((page) => page !== admin);
  const all = await size(startup);
  const withoutReact = await size(
    [...startup].filter((file) => !file.startsWith('assets/react-')),
  );
  console.log(
    [
      `web page, gzipped: startup ${all} B (without React ${withoutReact} B), admin ${admin.gzipped} B`,
      ...others.map(({ source, gzipped }) => `  ${source} ${gzipped} B`),
    ].join('\n'),
  );
  expect(all).toBeLessThanOrEqual(budget.startup);
  expect(withoutReact).toBeLessThanOrEqual(budget.startupWithoutReact);
  expect(admin.gzipped).toBeLessThanOrEqual(budget.admin);
  for (const { source, gzipped } of others) {
    expect(gzipped, source).toBeLessThanOrEqual(budget.page);
  }
});

it('loads the admin and its stylesheet only when it opens', async () => {
  const { startup, pages } = await built();
  // Text only the admin's own components hold.
  const text = 'Apply filters';
  const source = await readFile(
    new URL('../../../../packages/admin/src/filters.tsx', import.meta.url),
    'utf8',
  );
  expect(source, 'the admin still says it').toContain(text);
  const admin = pages.find(({ source }) => source.endsWith('admin-page.tsx'));
  if (admin === undefined) throw new Error('The admin is not a page chunk.');
  const holds = async (files: Iterable<string>) => {
    for (const file of files) {
      if ((await read(file)).text.includes(text)) return true;
    }
    return false;
  };
  expect(await holds(admin.files)).toBe(true);
  expect(await holds(startup)).toBe(false);
  expect(admin.files.some((file) => file.endsWith('.css'))).toBe(true);
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
  const chunks = await manifest();
  const files = new Set(
    Object.values(chunks).flatMap(({ file, css }) => [file, ...(css ?? [])]),
  );
  for (const file of files) {
    const { text } = await read(file);
    for (const found of Object.keys(server).filter((needle) =>
      text.includes(needle),
    )) {
      throw new Error(`${file} holds server code: "${found}"`);
    }
  }
});
