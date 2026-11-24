import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type * as TS from 'typescript';
import { apply, shown } from './changes.js';
import { existing, loadConfig } from './config.js';
import {
  type ListElement,
  migrationList,
  migrationsEdit,
  parse,
} from './edit.js';
import { Exit } from './exit.js';
import { call } from './layout.js';
import { loadTypeScript, type TypeScript } from './typescript.js';

export const migrationUsage =
  'Usage: lattice migration <name> [--transaction] [--dry-run]';

export const migrationHelp = `${migrationUsage}

Adds a data migration: its file, with the next id, and its place at the end
of the list that migrate() runs.

  <name>             Kebab case: add-notes-index.
  --transaction      Run it and its record in one transaction (a replica set).
  --dry-run          Print the changes as a diff and write nothing.
`;

const options = {
  transaction: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

/** How many digits an id has in a file name, as the crm's `0001-…` have. */
const digits = 4;

/** The object a default export holds, under `satisfies`, `as` and parentheses. */
function exported(
  ts: TypeScript,
  source: TS.SourceFile,
): TS.ObjectLiteralExpression | undefined {
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    let value: TS.Expression = statement.expression;
    while (
      ts.isSatisfiesExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isParenthesizedExpression(value)
    ) {
      value = value.expression;
    }
    return ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  return undefined;
}

/** A listed migration's id and name, read from its file's default export. */
async function readMigration(
  ts: TypeScript,
  root: string,
  index: string,
  element: ListElement,
): Promise<{ readonly id: number; readonly name: string }> {
  const path = resolve(
    dirname(index),
    element.specifier.replace(/\.js$/, '.ts'),
  );
  const file = shown(root, path);
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) {
    throw new Exit(`${file}, which the list imports, does not exist`, 1);
  }
  const object = exported(ts, parse(ts, path, text));
  const value = (key: string) =>
    object?.properties.find(
      (property): property is TS.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === key,
    )?.initializer;
  const id = value('id');
  const name = value('name');
  if (
    id === undefined ||
    !ts.isNumericLiteral(id) ||
    name === undefined ||
    !ts.isStringLiteral(name)
  ) {
    throw new Exit(
      `cannot read the id and name of ${file}: its default export needs a numeric id and a string name`,
      1,
    );
  }
  return { id: Number(id.text), name: name.text };
}

/**
 * The list's own checks, as migrate() makes them: ids 1, 2, 3 … in order,
 * none twice. The words are migrate()'s, with the error it would throw.
 */
function checkIds(file: string, ids: readonly number[]): void {
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Exit(
        `two migrations in ${file} share an id: ${id} (migrate() throws MigrationError.Duplicate)`,
        1,
      );
    }
    seen.add(id);
  }
  ids.forEach((id, index) => {
    if (id !== index + 1) {
      throw new Exit(
        `migration ids in ${file} must run 1, 2, 3 … in list order, with no gap: expected ${index + 1}, found ${id} (migrate() throws MigrationError.Gap)`,
        1,
      );
    }
  });
}

/**
 * A new migration: its id and name, and `transaction` when asked. Its `up`
 * throws until it is written, so a build that runs it early fails instead
 * of recording it as done.
 */
function migrationText(id: number, name: string, transaction: boolean): string {
  return [
    "import type { Migration } from '@latticecms/store-mongo';",
    '',
    '/**',
    ' * What this migration changes, and why. `up` must be safe to run again',
    ' * after it failed partway: the next run retries it.',
    ' *',
    " * `up({ db, session, signal, logger })` receives the store's raw `db`,",
    " * whose documents are in their stored shape; the transaction's `session`",
    ' * when `transaction` is true, to pass to each call; a `signal` that aborts',
    ' * when the migrations lock is lost, to check in long loops; and a',
    " * `logger` with the migration's id and name.",
    ' */',
    'export default {',
    `  id: ${id},`,
    `  name: '${name}',`,
    ...(transaction ? ['  transaction: true,'] : []),
    '  async up() {',
    ...call(
      '    ',
      'throw new Error',
      [
        `'Migration ${id} ${name} is not written yet: write up() before running it.'`,
      ],
      ';',
    ),
    '  },',
    '} satisfies Migration;',
    '',
  ].join('\n');
}

/** `lattice migration`: writes the next migration and appends it to the list. */
export async function migrationCommand(
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const { values: flags, positionals } = parseArgs({
    args: [...args],
    options,
    allowPositionals: true,
    strict: true,
  });
  if (flags.help === true) {
    process.stdout.write(migrationHelp);
    return;
  }
  const [name, ...extra] = positionals;
  if (name === undefined || extra.length > 0) {
    throw new Exit(
      name === undefined
        ? 'migration needs a name'
        : 'migration takes one name',
      2,
    );
  }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new Exit(
      `"${name}" is not a migration name: use kebab case, as add-notes-index`,
      2,
    );
  }
  const config = await loadConfig(cwd);
  const { root } = config;
  const directory = await existing(config, 'migrations', 'directory');
  const index = join(directory, 'index.ts');
  const file = shown(root, index);
  if (!existsSync(index)) {
    throw new Exit(`${file} does not exist: the migrations list goes there`, 1);
  }
  const ts = loadTypeScript(root);
  const before = await readFile(index, 'utf8');
  const list = migrationList(ts, parse(ts, index, before), file);
  if (typeof list === 'string') throw new Exit(list, 1);

  const listed = await Promise.all(
    list.elements.map((element) => readMigration(ts, root, index, element)),
  );
  checkIds(
    file,
    listed.map(({ id }) => id),
  );
  if (listed.some((migration) => migration.name === name)) {
    throw new Exit(`${file} already lists a migration named ${name}`, 1);
  }
  const taken = (await readdir(directory)).find(
    (entry) => entry.replace(/^\d+-/, '').replace(/\.[cm]?tsx?$/, '') === name,
  );
  if (taken !== undefined) {
    throw new Exit(`${shown(root, join(directory, taken))} already exists`, 1);
  }

  const id = listed.length + 1;
  const base = `${String(id).padStart(digits, '0')}-${name}`;
  const path = join(directory, `${base}.ts`);
  const local = `m${String(id).padStart(digits, '0')}`;
  await apply(
    root,
    [
      {
        path,
        before: undefined,
        after: migrationText(id, name, flags.transaction === true),
      },
    ],
    [migrationsEdit(ts, index, file, before, list, local, `./${base}.js`)],
    flags['dry-run'] === true,
  );
}
