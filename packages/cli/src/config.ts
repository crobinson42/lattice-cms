import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Exit, isRecord } from './exit.js';
import { fieldProblem } from './names.js';

/** Where an app keeps what the CLI reads and edits, as absolute paths. */
export type Config = {
  /** The directory of the app's `package.json`. */
  readonly root: string;
  readonly collections: string;
  readonly composition: string;
  readonly events: string;
  readonly family: { readonly file: string; readonly name: string };
  /** The tenant field of a new collection, when the app names one. */
  readonly tenant: string | undefined;
};

/** The `"lattice"` keys, each defaulting to the crm's layout. `tenant` has no default. */
const defaults = {
  collections: 'src/domain/collections',
  composition: 'src/servers/rpc/contract.ts',
  events: 'src/domain/events/domain-events.ts',
  family: 'src/app/use-cases/context.ts#AppUseCase',
};

type PathKey = keyof typeof defaults;

const keys = [...Object.keys(defaults), 'tenant'];

/** The nearest directory at or above `cwd` with a `package.json`. */
function rootOf(cwd: string): string {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) {
      throw new Exit(`no package.json in ${cwd} or above it`, 1);
    }
  }
}

/**
 * The app's config: the `"lattice"` key of the nearest `package.json`, over
 * the defaults. Anything wrong with it is a usage error that names the file
 * and the key: invalid JSON, an unknown key, a value that is not a
 * non-empty string, a path outside the app, or a path that is missing or
 * of the wrong kind.
 */
export async function loadConfig(cwd: string): Promise<Config> {
  const root = rootOf(cwd);
  const manifestPath = join(root, 'package.json');
  const manifestName = relative(cwd, manifestPath) || 'package.json';
  function fail(message: string): never {
    throw new Exit(message, 2);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(
      `${manifestName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const given = isRecord(manifest) ? (manifest.lattice ?? {}) : {};
  if (!isRecord(given)) fail(`"lattice" in ${manifestName} must be an object`);
  const values: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (!keys.includes(key)) {
      fail(`unknown key "lattice.${key}" in ${manifestName}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`"lattice.${key}" in ${manifestName} must be a non-empty string`);
    }
    values[key] = value;
  }
  const family = /^(.+)#([A-Za-z_$][\w$]*)$/.exec(values.family ?? '');
  const familyFile = family?.[1];
  const familyName = family?.[2];
  if (familyFile === undefined || familyName === undefined) {
    fail(
      `"lattice.family" in ${manifestName} must be a file and an export, as "${defaults.family}"`,
    );
  }

  /** A path inside the app, of the kind the key names, that exists. */
  const path = async (
    key: PathKey,
    value: string,
    kind: 'file' | 'directory',
  ): Promise<string> => {
    const absolute = resolve(root, value);
    const inside = relative(root, absolute);
    if (isAbsolute(value) || inside === '..' || inside.startsWith(`..${sep}`)) {
      fail(
        `"lattice.${key}" in ${manifestName} must be a path inside the app, not ${value}`,
      );
    }
    const found = await stat(absolute).catch(() => undefined);
    if (found === undefined) {
      fail(
        `${value} does not exist: set "lattice.${key}" in ${manifestName} to the app's ${kind}`,
      );
    }
    if (found.isDirectory() !== (kind === 'directory')) {
      fail(`"lattice.${key}" in ${manifestName} must be a ${kind}: ${value}`);
    }
    return absolute;
  };
  const tenant = values.tenant;
  const problem = tenant === undefined ? undefined : fieldProblem(tenant);
  if (problem !== undefined) {
    fail(`"lattice.tenant" in ${manifestName}: ${problem}`);
  }
  return {
    root,
    collections: await path(
      'collections',
      values.collections ?? defaults.collections,
      'directory',
    ),
    composition: await path(
      'composition',
      values.composition ?? defaults.composition,
      'file',
    ),
    events: await path('events', values.events ?? defaults.events, 'file'),
    family: {
      file: await path('family', familyFile, 'file'),
      name: familyName,
    },
    tenant,
  };
}
