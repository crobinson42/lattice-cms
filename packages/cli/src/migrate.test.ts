import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  bin,
  copy,
  crmCopy,
  edit,
  lattice,
  removeTemps,
  repo,
  run,
} from './test/apps.js';

// `lattice migrate` against the test replica set, each run in a database of
// its own. The fixture's migrate module is built once with tsc.

const url = inject('mongoUrl');
const databases: string[] = [];
const tsc = join(repo, 'node_modules/typescript/bin/tsc');

/** The environment a run reads its store from: a fresh database. */
function fresh(): Record<string, string> {
  const database = `cli_${crypto.randomUUID().replaceAll('-', '')}`;
  databases.push(database);
  return { MONGODB_URL: url, MONGODB_DATABASE: database };
}

const migrate = (app: string, env: Record<string, string>) =>
  run(app, [bin, 'migrate'], env);

/** A ConsoleLogger line's start: its time and level. */
const at = (level: string) =>
  `\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z ${level}`;

/** migrate()'s line for a migration that ran. */
const ranLine = (id: number, name: string) =>
  `${at('info')} migration \\{"id":${id},"name":"${name}","durationMs":\\d+,"outcome":"ok"\\}\\n`;

/** The ids `_migrations` records in a database. */
async function recorded(database: string): Promise<number[]> {
  const client = new MongoClient(url);
  try {
    const records = await client
      .db(database)
      .collection<{ _id: number }>('_migrations')
      .find()
      .sort({ _id: 1 })
      .toArray();
    return records.map((record) => record._id);
  } finally {
    await client.close();
  }
}

/** Points `lattice.migrate` at `path`, with the fixture's tenant. */
const useModule = (app: string, path: string) =>
  writeFile(
    join(app, 'package.json'),
    JSON.stringify({
      type: 'module',
      lattice: { tenant: 'organizationId', migrate: path },
    }),
  );

afterAll(async () => {
  await removeTemps();
  const client = new MongoClient(url);
  await Promise.all(
    databases.map((database) => client.db(database).dropDatabase()),
  );
  await client.close();
});

describe('lattice migrate', () => {
  let app = '';

  beforeAll(async () => {
    app = await copy();
    const build = run(app, [
      tsc,
      '-p',
      '.',
      '--noEmit',
      'false',
      '--rootDir',
      'src',
      '--outDir',
      'dist',
    ]);
    expect(build.stdout).toBe('');
  });

  it('runs a pending migration, then finds none', async () => {
    const env = fresh();
    // migrate()'s own lines, each once: the CLI adds none.
    const first = migrate(app, env);
    expect(first.stderr).toBe('');
    expect(first.stdout).toMatch(
      new RegExp(`^${ranLine(1, 'index-company-names')}$`),
    );
    expect(first.code).toBe(0);

    const second = migrate(app, env);
    expect(second.stdout).toMatch(
      new RegExp(`^${at('info')} migrations up to date \\{"last":1\\}\\n$`),
    );
    expect(second.code).toBe(0);
  });

  it('exits 1 with migrate()’s message on a list with a gap', async () => {
    await writeFile(
      join(app, 'dist/gap.js'),
      "import * as built from './servers/scripts/migrate.js';\n\nexport const store = built.store;\nexport const migrations = [...built.migrations, { id: 3, name: 'three', async up() {} }];\n",
    );
    await useModule(app, 'dist/gap.js');
    const { code, stderr } = migrate(app, fresh());
    expect(stderr).toBe(
      'lattice: Migration ids must run 1, 2, 3 … in list order, with no gap {"expected":2,"found":3}\n',
    );
    expect(code).toBe(1);
  });

  it('exits 1 when the module has no store', async () => {
    await writeFile(
      join(app, 'dist/no-store.js'),
      'export const migrations = [];\n',
    );
    await useModule(app, 'dist/no-store.js');
    expect(migrate(app, fresh())).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'lattice: dist/no-store.js must export store, a MongoStore that is not started\n',
    });
  });

  it('exits 1 with the install line when store-mongo is not in the app', async () => {
    const bare = await copy(undefined, 'app', '@latticecms/store-mongo');
    expect(lattice(bare, 'migrate')).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'lattice: @latticecms/store-mongo is not installed in the app: run npm install @latticecms/store-mongo\n',
    });
  });

  it('refuses a migration in the crm until it is written, then runs it', async () => {
    const crm = await crmCopy();
    expect(lattice(crm, 'migration', 'add-notes-index').code).toBe(0);
    const build = () => {
      const built = run(crm, [tsc, '-p', 'tsconfig.json']);
      expect(built.stdout).toBe('');
      expect(built.code).toBe(0);
    };
    build();
    const env = fresh();
    const database = env.MONGODB_DATABASE ?? '';
    const message =
      'Migration 2 add-notes-index is not written yet: write up\\(\\) before running it\\.';

    // The stub throws, so it is not recorded as done.
    const stub = migrate(crm, env);
    expect(stub.stdout).toMatch(
      new RegExp(
        `^${at('info')} deals backfilled \\{"id":1,"name":"backfill-deal-archived","modifiedCount":0\\}\\n${ranLine(1, 'backfill-deal-archived')}$`,
      ),
    );
    expect(stub.stderr).toMatch(
      new RegExp(
        `^${at('error')} ${message} \\{"id":2,"name":"add-notes-index",.*"outcome":"failed".*\\}\\nlattice: ${message}\\n$`,
      ),
    );
    expect(stub.code).toBe(1);
    expect(await recorded(database)).toEqual([1]);

    // Written, as a developer would, then built: it runs.
    await edit(crm, 'src/infra/migrations/0002-add-notes-index.ts', (text) =>
      text.replace(/async up\(\) \{[\s\S]*?\n {2}\},/, 'async up() {},'),
    );
    build();
    const written = migrate(crm, env);
    expect(written.stderr).toBe('');
    expect(written.stdout).toMatch(
      new RegExp(`^${ranLine(2, 'add-notes-index')}$`),
    );
    expect(written.code).toBe(0);
    expect(await recorded(database)).toEqual([1, 2]);
  });
});
