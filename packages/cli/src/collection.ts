import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type * as TS from 'typescript';
import { apply, type Change, shown, specifierOf } from './changes.js';
import { existing, loadConfig } from './config.js';
import {
  compareSpecifiers,
  compositionEdit,
  eventsEdit,
  importedAs,
  parse,
} from './edit.js';
import { Exit } from './exit.js';
import { fieldProblem, type Names, namesOf } from './names.js';
import { collectionText, type TestImport, testText } from './templates.js';
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
  const directory = await existing(config, 'collections', 'directory');
  const compositionPath = await existing(config, 'composition', 'file');
  const eventsPath = await existing(config, 'events', 'file');
  const ts = loadTypeScript(root);

  const file = join(directory, `${names.file}.ts`);
  const test = join(directory, `${names.file}.test.ts`);
  for (const path of [file, test]) {
    if (existsSync(path)) {
      throw new Exit(`${shown(root, path)} already exists`, 1);
    }
  }
  await checkUnused(ts, root, directory, names);

  const composition = compositionEdit(
    ts,
    compositionPath,
    shown(root, compositionPath),
    await readFile(compositionPath, 'utf8'),
    names,
    specifierOf(compositionPath, file),
  );
  const events = eventsEdit(
    ts,
    eventsPath,
    shown(root, eventsPath),
    await readFile(eventsPath, 'utf8'),
    names,
    specifierOf(eventsPath, file),
  );
  const edits = [composition, events];
  const app: TestImport | undefined =
    composition.app === undefined
      ? undefined
      : {
          name: composition.app,
          specifier: specifierOf(test, compositionPath),
        };
  const created: Change[] = [
    {
      path: file,
      before: undefined,
      after: collectionText(names, tenant, label),
    },
    {
      path: test,
      before: undefined,
      after: testText(names, app, compareSpecifiers),
    },
  ];

  await apply(root, created, edits, flags['dry-run'] === true);
  if (flags['dry-run'] === true) return;
  process.stdout.write(
    `${names.slug} is open to any signed-in caller. Tighten its access in ${shown(root, compositionPath)}.\n`,
  );
}
