import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { copy, edit, files, lattice, read, removeTemps } from './test/apps.js';

afterAll(removeTemps);

const migrations = 'src/infra/migrations';
const index = `${migrations}/index.ts`;

/** A migration file with this id and name, as an app writes one. */
const migrationFile = (id: number, name: string) =>
  `import type { Migration } from '@latticecms/store-mongo';\n\nexport default {\n  id: ${id},\n  name: '${name}',\n  async up() {},\n} satisfies Migration;\n`;

describe('lattice migration', () => {
  it('writes the next migration and appends it to the list', async () => {
    const app = await copy();
    expect(lattice(app, 'migration', 'add-notes-index')).toEqual({
      code: 0,
      stdout: `created ${migrations}/0002-add-notes-index.ts\nedited ${index}\n`,
      stderr: '',
    });
    expect(await read(app, `${migrations}/0002-add-notes-index.ts`)).toBe(
      `import type { Migration } from '@latticecms/store-mongo';

/**
 * What this migration changes, and why. \`up\` must be safe to run again
 * after it failed partway: the next run retries it.
 *
 * \`up({ db, session, signal, logger })\` receives the store's raw \`db\`,
 * whose documents are in their stored shape; the transaction's \`session\`
 * when \`transaction\` is true, to pass to each call; a \`signal\` that aborts
 * when the migrations lock is lost, to check in long loops; and a
 * \`logger\` with the migration's id and name.
 */
export default {
  id: 2,
  name: 'add-notes-index',
  async up() {
    throw new Error(
      'Migration 2 add-notes-index is not written yet: write up() before running it.',
    );
  },
} satisfies Migration;
`,
    );
    expect(await read(app, index)).toBe(
      `import m0001 from './0001-index-company-names.js';
import m0002 from './0002-add-notes-index.js';

/** The app's data migrations, in id order. */
export const migrations = [m0001, m0002];
`,
    );

    // The next one reads both ids from the list.
    expect(
      lattice(app, 'migration', 'backfill-notes', '--transaction').code,
    ).toBe(0);
    expect(await read(app, `${migrations}/0003-backfill-notes.ts`)).toContain(
      "  name: 'backfill-notes',\n  transaction: true,\n  async up() {\n",
    );
    expect(await read(app, index)).toContain(
      'export const migrations = [m0001, m0002, m0003];\n',
    );
  });

  it('prints a diff and writes nothing on --dry-run', async () => {
    const app = await copy();
    const before = await files(app);
    const { code, stdout } = lattice(
      app,
      'migration',
      'add-notes-index',
      '--dry-run',
    );
    expect(code).toBe(0);
    expect(stdout).toContain(
      `--- /dev/null\n+++ b/${migrations}/0002-add-notes-index.ts\n`,
    );
    expect(stdout).toContain(
      '-export const migrations = [m0001];\n+export const migrations = [m0001, m0002];\n',
    );
    expect(stdout).toMatch(/Dry run: nothing was written\.\n$/);
    expect(await files(app)).toEqual(before);
  });

  it('keeps comments and CRLF, and adds a line to a list on several lines', async () => {
    const app = await copy();
    const first = "import m0001 from './0001-index-company-names.js';";
    await edit(app, index, (text) =>
      text
        .replace(first, `${first} // the first`)
        .replace(
          'export const migrations = [m0001];',
          'export const migrations = [\n  m0001, // indexes\n];',
        )
        .replaceAll('\n', '\r\n'),
    );
    expect(lattice(app, 'migration', 'add-notes-index').code).toBe(0);
    expect(await read(app, index)).toBe(
      [
        `${first} // the first`,
        "import m0002 from './0002-add-notes-index.js';",
        '',
        "/** The app's data migrations, in id order. */",
        'export const migrations = [',
        '  m0001, // indexes',
        '  m0002,',
        '];',
        '',
      ].join('\r\n'),
    );
  });

  it('keeps a comment after a list on one line', async () => {
    const app = await copy();
    await edit(app, index, (text) =>
      text.replace('[m0001];', '[m0001]; // in id order'),
    );
    expect(lattice(app, 'migration', 'add-notes-index').code).toBe(0);
    expect(await read(app, index)).toContain(
      'export const migrations = [m0001, m0002]; // in id order\n',
    );
  });

  it('breaks a list onto lines when it no longer fits on one', async () => {
    const app = await copy();
    const name = 'theDataMigrationsOfThisApplicationInTheOrderTheyRun';
    await edit(app, index, (text) => text.replace('migrations =', `${name} =`));
    expect(lattice(app, 'migration', 'add-notes-index').code).toBe(0);
    expect(await read(app, index)).toContain(
      `export const ${name} = [\n  m0001,\n  m0002,\n];\n`,
    );
  });

  it.each([
    [
      'a gap',
      [3],
      `migration ids in ${index} must run 1, 2, 3 … in list order, with no gap: expected 2, found 3 (migrate() throws MigrationError.Gap)`,
    ],
    [
      'a duplicate',
      [1],
      `two migrations in ${index} share an id: 1 (migrate() throws MigrationError.Duplicate)`,
    ],
  ])('refuses a list with %s, in migrate()’s words', async (_, [id], why) => {
    const app = await copy();
    await writeFile(
      join(app, migrations, '0002-other.ts'),
      migrationFile(id ?? 0, 'other'),
    );
    await edit(app, index, (text) =>
      text
        .replace(
          "import m0001 from './0001-index-company-names.js';",
          "import m0001 from './0001-index-company-names.js';\nimport other from './0002-other.js';",
        )
        .replace('[m0001]', '[m0001, other]'),
    );
    const before = await files(app);
    expect(lattice(app, 'migration', 'add-notes-index')).toEqual({
      code: 1,
      stdout: '',
      stderr: `lattice: ${why}\n`,
    });
    expect(await files(app)).toEqual(before);
  });

  it.each([
    [
      'a name already in the list',
      ['index-company-names'],
      `lattice: ${index} already lists a migration named index-company-names\n`,
    ],
    [
      'a list with no exported array',
      ['add-notes-index'],
      `lattice: ${index} has no exported array of migrations\n`,
    ],
  ])('refuses %s with exit 1', async (label, args, stderr) => {
    const app = await copy();
    if (label.includes('no exported array')) {
      await edit(app, index, (text) => text.replace('export const', 'const'));
    }
    const before = await files(app);
    expect(lattice(app, 'migration', ...args)).toEqual({
      code: 1,
      stdout: '',
      stderr,
    });
    expect(await files(app)).toEqual(before);
  });

  it('exits 2 on a name that is not kebab case', async () => {
    const app = await copy();
    const { code, stderr } = lattice(app, 'migration', 'Add_Notes');
    expect(code).toBe(2);
    expect(stderr).toBe(
      'lattice: "Add_Notes" is not a migration name: use kebab case, as add-notes-index\nUsage: lattice migration <name> [--transaction] [--dry-run]\n',
    );
  });
});
