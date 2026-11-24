import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Exit, isRecord } from './exit.js';
import { fieldProblem } from './names.js';

/** The `"lattice"` keys that name paths, each defaulting to the crm's layout. */
const defaults = {
  collections: 'src/domain/collections',
  composition: 'src/servers/rpc/contract.ts',
  events: 'src/domain/events/domain-events.ts',
  migrations: 'src/infra/migrations',
  migrate: 'dist/servers/scripts/migrate.js',
};

export type PathKey = keyof typeof defaults;

/** Every key. `tenant` has no default. */
const keys = [...Object.keys(defaults), 'tenant'];

/** The app's config, checked: every path is inside the app. */
export type Config = {
  /** The directory of the app's `package.json`. */
  readonly root: string;
  /** The `package.json`, as messages name it. */
  readonly manifest: string;
  /** Each path key's absolute path. */
  readonly paths: Readonly<Record<PathKey, string>>;
  /** Each path key's value as written, for messages. */
  readonly written: Readonly<Record<PathKey, string>>;
  /** The tenant field of a new collection, when the app names one. */
  readonly tenant: string | undefined;
};

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
 * non-empty string, a bad tenant field, or a path outside the app. Whether
 * a path exists is checked by the command that needs it, with `existing`.
 */
export async function loadConfig(cwd: string): Promise<Config> {
  const root = rootOf(cwd);
  const manifestPath = join(root, 'package.json');
  const manifest = relative(cwd, manifestPath) || 'package.json';
  function fail(message: string): never {
    throw new Exit(message, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(
      `${manifest} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const given = isRecord(parsed) ? (parsed.lattice ?? {}) : {};
  if (!isRecord(given)) fail(`"lattice" in ${manifest} must be an object`);
  const values: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (!keys.includes(key)) {
      fail(`unknown key "lattice.${key}" in ${manifest}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`"lattice.${key}" in ${manifest} must be a non-empty string`);
    }
    values[key] = value;
  }
  const written: Record<PathKey, string> = {
    collections: values.collections ?? defaults.collections,
    composition: values.composition ?? defaults.composition,
    events: values.events ?? defaults.events,
    migrations: values.migrations ?? defaults.migrations,
    migrate: values.migrate ?? defaults.migrate,
  };
  const inside = (key: PathKey): string => {
    const value = written[key];
    const absolute = resolve(root, value);
    const path = relative(root, absolute);
    if (isAbsolute(value) || path === '..' || path.startsWith(`..${sep}`)) {
      fail(
        `"lattice.${key}" in ${manifest} must be a path inside the app, not ${value}`,
      );
    }
    return absolute;
  };
  const tenant = values.tenant;
  const problem = tenant === undefined ? undefined : fieldProblem(tenant);
  if (problem !== undefined) {
    fail(`"lattice.tenant" in ${manifest}: ${problem}`);
  }
  return {
    root,
    manifest,
    paths: {
      collections: inside('collections'),
      composition: inside('composition'),
      events: inside('events'),
      migrations: inside('migrations'),
      migrate: inside('migrate'),
    },
    written,
    tenant,
  };
}

/**
 * The path of `key`, which must exist and be a file or a directory as
 * `kind` says. Otherwise a usage error that names the key.
 */
export async function existing(
  config: Config,
  key: PathKey,
  kind: 'file' | 'directory',
): Promise<string> {
  const path = config.paths[key];
  const value = config.written[key];
  const found = await stat(path).catch(() => undefined);
  if (found === undefined) {
    throw new Exit(
      `${value} does not exist: set "lattice.${key}" in ${config.manifest} to the app's ${kind}`,
      2,
    );
  }
  if (found.isDirectory() !== (kind === 'directory')) {
    throw new Exit(
      `"lattice.${key}" in ${config.manifest} must be a ${kind}: ${value}`,
      2,
    );
  }
  return path;
}
