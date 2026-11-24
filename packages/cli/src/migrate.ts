import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type * as HexokLogger from '@hexok/logger';
import type * as StoreMongo from '@latticecms/store-mongo';
import { shown } from './changes.js';
import { loadConfig } from './config.js';
import { Exit, isRecord } from './exit.js';

export const migrateUsage = 'Usage: lattice migrate';

export const migrateHelp = `${migrateUsage}

Runs the app's pending migrations with @latticecms/store-mongo's migrate(),
from the module "lattice.migrate" in package.json names (a built file that
exports store and migrations). Build the app first.
`;

const options = { help: { type: 'boolean', short: 'h' } } as const;

/** A package's entry, resolved and imported from the app's directory. */
async function fromApp(
  root: string,
  name: string,
  install: string,
): Promise<unknown> {
  let resolved: string;
  try {
    resolved = createRequire(join(root, 'package.json')).resolve(name);
  } catch {
    throw new Exit(`${name} is not installed in the app: run ${install}`, 1);
  }
  return import(pathToFileURL(resolved).href);
}

// Each guard checks what the command uses of the package.
function isStoreMongo(value: unknown): value is typeof StoreMongo {
  return (
    isRecord(value) &&
    typeof value.migrate === 'function' &&
    typeof value.MongoStore === 'function' &&
    typeof value.MigrationError === 'function'
  );
}

function isLogger(value: unknown): value is typeof HexokLogger {
  return isRecord(value) && typeof value.ConsoleLogger === 'function';
}

/** Whether `value` is a migration as migrate() takes one. */
function isMigration(value: unknown): value is StoreMongo.Migration {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string' &&
    typeof value.up === 'function' &&
    (value.transaction === undefined || typeof value.transaction === 'boolean')
  );
}

/** One line for an error: a MigrationError's message and data, or the message. */
function lineOf(storeMongo: typeof StoreMongo, error: unknown): string {
  if (storeMongo.MigrationError.is(error)) {
    const data = 'data' in error ? JSON.stringify(error.data) : undefined;
    return data === undefined || data === '{}'
      ? error.message
      : `${error.message} ${data}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * `lattice migrate`: imports the app's built module, starts its store, runs
 * migrate() with a console logger, and stops the store. Ordering, history
 * and the lock are migrate()'s.
 */
export async function migrateCommand(
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
    process.stdout.write(migrateHelp);
    return;
  }
  if (positionals.length > 0) throw new Exit('migrate takes no arguments', 2);
  const config = await loadConfig(cwd);
  const { root } = config;
  const path = config.paths.migrate;
  const file = shown(root, path);

  const storeMongo = await fromApp(
    root,
    '@latticecms/store-mongo',
    'npm install @latticecms/store-mongo',
  );
  if (!isStoreMongo(storeMongo)) {
    throw new Exit('@latticecms/store-mongo in the app has no migrate()', 1);
  }
  const loggers = await fromApp(
    root,
    '@hexok/logger',
    'npm install @hexok/logger',
  );
  if (!isLogger(loggers)) {
    throw new Exit('@hexok/logger in the app has no ConsoleLogger', 1);
  }
  if (!existsSync(path)) {
    throw new Exit(
      `${file} does not exist: build the app first, or set "lattice.migrate" in ${config.manifest}`,
      1,
    );
  }
  let module: unknown;
  try {
    module = await import(pathToFileURL(path).href);
  } catch (error) {
    throw new Exit(`cannot load ${file}: ${lineOf(storeMongo, error)}`, 1);
  }
  const store = isRecord(module) ? module.store : undefined;
  const migrations = isRecord(module) ? module.migrations : undefined;
  if (!(store instanceof storeMongo.MongoStore)) {
    throw new Exit(
      `${file} must export store, a MongoStore that is not started`,
      1,
    );
  }
  if (!Array.isArray(migrations) || !migrations.every(isMigration)) {
    throw new Exit(
      `${file} must export migrations, the list of migrations migrate() runs`,
      1,
    );
  }

  // migrate() logs each migration it runs, with its duration, and
  // "migrations up to date" when none is pending, so the command adds no
  // lines of its own.
  try {
    await store.start();
    await storeMongo.migrate(store, migrations, {
      logger: new loggers.ConsoleLogger(),
    });
  } catch (error) {
    throw new Exit(lineOf(storeMongo, error), 1);
  } finally {
    await store.stop();
  }
}
