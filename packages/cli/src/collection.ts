import { constants, existsSync } from 'node:fs';
import {
  access,
  chmod,
  link,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type * as TS from 'typescript';
import { loadConfig } from './config.js';
import { diff } from './diff.js';
import {
  applyInserts,
  compareSpecifiers,
  compositionEdit,
  eventsEdit,
  type FileEdit,
  importedAs,
  parse,
} from './edit.js';
import { Exit } from './exit.js';
import { fieldProblem, type Names, namesOf } from './names.js';
import {
  collectionText,
  type TestImport,
  testPackageNames,
  testText,
} from './templates.js';
import { loadTypeScript, type TypeScript } from './typescript.js';

export const collectionUsage =
  'Usage: lattice collection <slug> [--tenant <field> | --global] [--label <singular>,<plural>] [--dry-run]';

export const collectionHelp = `${collectionUsage}

Adds a collection to the app: its file, a test, its registration in the
composition, and its events in the events catalog.

  <slug>             Lower snake case, plural: deal_notes.
  --tenant <field>   The tenant field. The default is "lattice.tenant" in package.json.
  --global           No tenant: one set of rows for every caller.
  --label s,p        The label, when the slug's singular is wrong: person,people.
  --dry-run          Print the changes as a diff and write nothing.
`;

const options = {
  tenant: { type: 'string' },
  global: { type: 'boolean' },
  label: { type: 'string' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

/** A file to create or edit, with its text before and after. */
type Change = {
  readonly path: string;
  readonly before: string | undefined;
  readonly after: string;
};

/** A path from the app's root, with forward slashes, as output names it. */
const shown = (root: string, path: string) =>
  relative(root, path).split(sep).join('/');

/** The import specifier for `to` from a file at `from`: relative, ending in `.js`. */
function specifierOf(from: string, to: string): string {
  const path = relative(dirname(from), to)
    .split(sep)
    .join('/')
    .replace(/\.tsx?$/, '.js');
  return path.startsWith('.') ? path : `./${path}`;
}

/** The label from `--label singular,plural`. */
function labelOf(value: string | undefined) {
  if (value === undefined) return undefined;
  const parts = value.split(',').map((part) => part.trim());
  const [singular, plural] = parts;
  const word = /^[\p{L}\p{N}][\p{L}\p{N} -]*$/u;
  if (
    parts.length !== 2 ||
    singular === undefined ||
    plural === undefined ||
    !word.test(singular) ||
    !word.test(plural)
  ) {
    throw new Exit(
      `--label takes a singular and a plural of letters, digits, spaces and hyphens: --label person,people`,
      2,
    );
  }
  return { singular, plural };
}

/** The tenant field from the flags and the config, or a refusal. */
function tenantOf(
  flags: { readonly tenant?: string; readonly global?: boolean },
  configured: string | undefined,
): string | undefined {
  if (flags.global === true && flags.tenant !== undefined) {
    throw new Exit('--tenant and --global cannot both be given', 2);
  }
  if (flags.global === true) return undefined;
  const tenant = flags.tenant ?? configured;
  if (tenant === undefined) {
    throw new Exit(
      'name the tenant field with --tenant <field>, or pass --global; "lattice.tenant" in package.json sets a default',
      2,
    );
  }
  const problem = fieldProblem(tenant);
  if (problem !== undefined) throw new Exit(problem, 1);
  return tenant;
}

/**
 * Every call of core's `collection('<slug>', ...)`, by whatever name the
 * file imports it as, and every `through: '<slug>'`, in a file.
 */
function slugsIn(ts: TypeScript, source: TS.SourceFile) {
  const found: { readonly slug: string; readonly join: boolean }[] = [];
  const collection = importedAs(ts, source, 'collection', '@latticecms/core');
  const visit = (node: TS.Node): void => {
    if (
      collection !== undefined &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === collection
    ) {
      const [slug] = node.arguments;
      if (slug !== undefined && ts.isStringLiteral(slug)) {
        found.push({ slug: slug.text, join: false });
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'through' &&
      ts.isStringLiteral(node.initializer)
    ) {
      found.push({ slug: node.initializer.text, join: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Refuses a slug that a collection or a join collection in the app already has. */
async function checkUnused(
  ts: TypeScript,
  root: string,
  directory: string,
  names: Names,
): Promise<void> {
  const files = (await readdir(directory)).filter(
    (file) => /\.[cm]?tsx?$/.test(file) && !/\.(test|d)\.[cm]?tsx?$/.test(file),
  );
  for (const file of files) {
    const path = join(directory, file);
    const source = parse(ts, path, await readFile(path, 'utf8'));
    const taken = slugsIn(ts, source).find(({ slug }) => slug === names.slug);
    if (taken !== undefined) {
      throw new Exit(
        taken.join
          ? `"${names.slug}" is a join collection in ${shown(root, path)}`
          : `"${names.slug}" is a collection in ${shown(root, path)}`,
        1,
      );
    }
  }
}

/** The lines a refused edit would have added, and where, for each file. */
function byHand(
  root: string,
  created: readonly Change[],
  edits: readonly FileEdit[],
) {
  return [
    'Nothing was written. Make these changes by hand, or fix the shape and run the command again:',
    ...created.map(
      (change) =>
        `${shown(root, change.path)}, a new file:\n${change.after.trimEnd()}`,
    ),
    ...edits.flatMap((edit) =>
      edit.additions.map(
        (addition) =>
          `${shown(root, edit.path)}, ${addition.where}:\n${addition.lines}`,
      ),
    ),
  ].join('\n\n');
}

/**
 * Writes every change, or none. Each new text is staged in a file beside
 * its target. Then each edited file must still hold the text that was
 * parsed and be writable, and each new file must still be absent. Then the
 * staged files take their targets' places: a rename for an edited file,
 * and a link, which never replaces a file, for a new one. On any failure
 * the staged files are removed and the files already placed are restored.
 */
async function writeAll(root: string, changes: readonly Change[]) {
  const staged: { readonly change: Change; readonly temp: string }[] = [];
  const placed: Change[] = [];
  let current = '';
  try {
    for (const change of changes) {
      current = change.path;
      const temp = join(
        dirname(change.path),
        `.${basename(change.path)}.lattice-${process.pid}.tmp`,
      );
      await writeFile(temp, change.after, { flag: 'wx' });
      staged.push({ change, temp });
      if (change.before !== undefined) {
        await chmod(temp, (await stat(change.path)).mode & 0o7777);
      }
    }
    for (const { change } of staged) {
      current = change.path;
      if (change.before === undefined) {
        if (existsSync(change.path)) {
          throw new Exit(`${shown(root, change.path)} already exists`, 1);
        }
      } else {
        await access(change.path, constants.W_OK);
        if ((await readFile(change.path, 'utf8')) !== change.before) {
          throw new Exit(
            `${shown(root, change.path)} changed while lattice ran; nothing was written`,
            1,
          );
        }
      }
    }
    for (const { change, temp } of staged) {
      current = change.path;
      if (change.before === undefined) {
        await link(temp, change.path);
        await rm(temp);
      } else {
        await rename(temp, change.path);
      }
      placed.push(change);
    }
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => rm(temp, { force: true })));
    for (const change of placed.reverse()) {
      if (change.before === undefined) await rm(change.path, { force: true });
      else await writeFile(change.path, change.before);
    }
    if (error instanceof Exit) throw error;
    const code =
      error instanceof Error && 'code' in error ? ` (${error.code})` : '';
    throw new Exit(
      `cannot write ${shown(root, current)}${code}; nothing was written`,
      1,
    );
  }
}

/** `lattice collection`: writes a collection, its test and its registrations. */
export async function collectionCommand(
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
    process.stdout.write(collectionHelp);
    return;
  }
  const [slug, ...extra] = positionals;
  if (slug === undefined || extra.length > 0) {
    throw new Exit(
      slug === undefined
        ? 'collection needs a slug'
        : 'collection takes one slug',
      2,
    );
  }
  const label = labelOf(flags.label);
  const config = await loadConfig(cwd);
  const tenant = tenantOf(flags, config.tenant);
  const names = namesOf(slug);
  const { root } = config;
  const ts = loadTypeScript(root);

  const file = join(config.collections, `${names.file}.ts`);
  const test = join(config.collections, `${names.file}.test.ts`);
  for (const path of [file, test]) {
    if (existsSync(path)) {
      throw new Exit(`${shown(root, path)} already exists`, 1);
    }
  }
  await checkUnused(ts, root, config.collections, names);

  const composition = compositionEdit(
    ts,
    config.composition,
    shown(root, config.composition),
    await readFile(config.composition, 'utf8'),
    names,
    specifierOf(config.composition, file),
  );
  const events = eventsEdit(
    ts,
    config.events,
    shown(root, config.events),
    await readFile(config.events, 'utf8'),
    names,
    specifierOf(config.events, file),
  );
  const edits = [composition, events];
  const family: TestImport = {
    name: config.family.name,
    specifier: specifierOf(test, config.family.file),
  };
  const app: TestImport | undefined =
    composition.app === undefined
      ? undefined
      : {
          name: composition.app,
          specifier: specifierOf(test, config.composition),
        };
  const testNames = [
    ...testPackageNames(tenant !== undefined),
    family.name,
    ...(app === undefined ? [] : [app.name]),
  ];
  if (testNames.includes(names.exportName)) {
    throw new Exit(
      `the export ${names.exportName} would clash with an import of the same name in its test`,
      1,
    );
  }
  const created: Change[] = [
    {
      path: file,
      before: undefined,
      after: collectionText(names, tenant, label),
    },
    {
      path: test,
      before: undefined,
      after: testText(
        names,
        tenant !== undefined,
        family,
        app,
        compareSpecifiers,
      ),
    },
  ];

  const refused = edits.flatMap((edit) =>
    edit.refused === undefined ? [] : [edit.refused],
  );
  if (refused.length > 0) {
    throw new Exit(refused.join('; '), 1, byHand(root, created, edits));
  }
  const changes: Change[] = [
    ...created,
    ...edits.map((edit) => ({
      path: edit.path,
      before: edit.before,
      after: applyInserts(
        edit.before,
        edit.additions.flatMap((addition) => addition.inserts),
      ),
    })),
  ];

  if (flags['dry-run'] === true) {
    for (const change of changes) {
      process.stdout.write(
        diff(shown(root, change.path), change.before, change.after),
      );
    }
    process.stdout.write('Dry run: nothing was written.\n');
    return;
  }
  await writeAll(root, changes);
  for (const change of changes) {
    process.stdout.write(
      `${change.before === undefined ? 'created' : 'edited'} ${shown(root, change.path)}\n`,
    );
  }
  process.stdout.write(
    `${names.slug} is open to any signed-in caller. Tighten its access in ${shown(root, config.composition)}.\n`,
  );
}
