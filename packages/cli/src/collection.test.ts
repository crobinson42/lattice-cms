import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bin,
  check,
  copy,
  crmCopy,
  edit,
  env,
  files,
  fixture,
  lattice,
  read,
  removeTemps,
  repo,
  run,
} from './test/apps.js';

afterAll(removeTemps);

const collections = 'src/domain/collections';
const composition = 'src/servers/rpc/contract.ts';
const events = 'src/domain/events/domain-events.ts';

describe('lattice collection', () => {
  it('adds a tenanted and a global collection that compile and pass their tests', async () => {
    const app = await copy();

    const tenanted = lattice(app, 'collection', 'deal_notes');
    expect(tenanted).toEqual({
      code: 0,
      stdout: [
        `created ${collections}/deal-notes.ts`,
        `created ${collections}/deal-notes.test.ts`,
        `edited ${composition}`,
        `edited ${events}`,
        `deal_notes is open to any signed-in caller. Tighten its access in ${composition}.`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(await read(app, `${collections}/deal-notes.ts`)).toBe(
      `import { collection } from '@latticecms/core';
import { z } from 'zod';

export const DealNotes = collection('deal_notes', {
  schema: z.object({
    name: z.string().min(1),
  }),
  tenant: 'organizationId',
});
`,
    );
    expect(await read(app, `${collections}/deal-notes.test.ts`)).toBe(
      `import { describe, expect, it } from 'vitest';
import { api } from '../../servers/rpc/contract.js';
import { DealNotes } from './deal-notes.js';

// What the scaffold made. Test behavior through the app's own setup.
describe('deal_notes', () => {
  it('is in the app, with its operations', () => {
    const operations = ['find', 'count', 'get', 'create', 'update', 'delete'];
    const keys = Object.keys(api.contract.deal_notes);
    expect(keys).toEqual(expect.arrayContaining(operations));
  });

  it('parses a document, and refuses one without a name', () => {
    const parsed = DealNotes.schema.parse({ name: 'First' });
    expect(parsed).toMatchObject({ name: 'First' });
    const refused = DealNotes.schema.safeParse({});
    const paths = refused.error?.issues.map((issue) => issue.path);
    expect(paths).toEqual([['name']]);
  });
});
`,
    );

    const global = lattice(
      app,
      'collection',
      'people',
      '--global',
      '--label',
      'person,people',
    );
    expect(global.code).toBe(0);
    expect(await read(app, `${collections}/people.ts`)).toBe(
      `import { collection } from '@latticecms/core';
import { z } from 'zod';

export const People = collection('people', {
  schema: z.object({
    name: z.string().min(1),
  }),
  label: { singular: 'person', plural: 'people' },
});
`,
    );
    // A global collection's test is the same: it builds nothing.
    expect(await read(app, `${collections}/people.test.ts`)).toContain(
      '    const refused = People.schema.safeParse({});\n',
    );

    expect(await read(app, composition)).toBe(
      `import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { DealNotes } from '../../domain/collections/deal-notes.js';
import { People } from '../../domain/collections/people.js';

const anyone = () => true;

/** The app's API. */
export const api = framework({ family: AppUseCase })
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(DealNotes, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(People, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  });
`,
    );
    expect(await read(app, events)).toBe(
      `import { EventCatalog } from 'hexok';
import { Companies } from '../collections/companies.js';
import { Contacts } from '../collections/contacts.js';
import { DealNotes } from '../collections/deal-notes.js';
import { People } from '../collections/people.js';

/** The app's one catalog. */
export class DomainEvents extends EventCatalog('domain-events', {
  companiesCreated: Companies.events.created,
  companiesUpdated: Companies.events.updated,
  companiesDeleted: Companies.events.deleted,
  contactsCreated: Contacts.events.created,
  contactsUpdated: Contacts.events.updated,
  contactsDeleted: Contacts.events.deleted,
  dealNotesCreated: DealNotes.events.created,
  dealNotesUpdated: DealNotes.events.updated,
  dealNotesDeleted: DealNotes.events.deleted,
  peopleCreated: People.events.created,
  peopleUpdated: People.events.updated,
  peopleDeleted: People.events.deleted,
  contactCompaniesCreated: Contacts.relations.companies.through.events.created,
  contactCompaniesUpdated: Contacts.relations.companies.through.events.updated,
  contactCompaniesDeleted: Contacts.relations.companies.through.events.deleted,
}) {}
`,
    );

    await check(app, '.', [
      `${collections}/deal-notes.test.ts`,
      `${collections}/people.test.ts`,
    ]);
  });

  it('writes access inline when the composition has no anyone', async () => {
    const app = await copy();
    const before = await read(app, composition);
    await writeFile(
      join(app, composition),
      before
        .replace('const anyone = () => true;\n\n', '')
        .replaceAll('anyone', '() => true'),
    );
    expect(lattice(app, 'collection', 'notes').code).toBe(0);
    expect(await read(app, composition)).toContain(`  .collection(Notes, {
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
  });
`);
  });

  it('prints the changes as a diff and writes nothing on --dry-run', async () => {
    const app = await copy();
    const before = await files(app);
    const { code, stdout } = lattice(app, 'collection', 'notes', '--dry-run');
    expect(code).toBe(0);
    expect(stdout).toContain(`--- /dev/null\n+++ b/${collections}/notes.ts\n`);
    expect(stdout).toContain(`--- a/${composition}\n+++ b/${composition}\n`);
    expect(stdout).toContain(
      "+import { Notes } from '../../domain/collections/notes.js';\n",
    );
    expect(stdout).toContain('+  notesCreated: Notes.events.created,\n');
    expect(stdout).toMatch(/Dry run: nothing was written\.\n$/);
    expect(await files(app)).toEqual(before);
  });

  it('refuses a second run and changes nothing', async () => {
    const app = await copy();
    expect(lattice(app, 'collection', 'notes').code).toBe(0);
    const before = await files(app);
    expect(lattice(app, 'collection', 'notes')).toEqual({
      code: 1,
      stdout: '',
      stderr: `lattice: ${collections}/notes.ts already exists\n`,
    });
    expect(await files(app)).toEqual(before);
  });

  it.each([
    [
      'a bad slug',
      ['DealNotes'],
      '"DealNotes" is not a slug: use lower snake case, as deal_notes',
    ],
    [
      'a reserved key',
      ['router'],
      '"router" is reserved: a ts-pf implementer key',
    ],
    [
      'an existing slug',
      ['companies'],
      `${collections}/companies.ts already exists`,
    ],
    [
      "a join collection's name",
      ['contact_companies'],
      `"contact_companies" is a join collection in ${collections}/contacts.ts`,
    ],
    [
      'a reserved tenant field',
      ['notes', '--tenant', 'createdAt'],
      '"createdAt" is a reserved field name',
    ],
  ])('refuses %s with exit 1 and writes nothing', async (_, args, why) => {
    const app = await copy();
    const before = await files(app);
    expect(lattice(app, 'collection', ...args)).toEqual({
      code: 1,
      stdout: '',
      stderr: `lattice: ${why}\n`,
    });
    expect(await files(app)).toEqual(before);
  });

  it.each([
    [
      'two chains',
      (text: string) =>
        `${text}\nexport const other = framework({ family: AppUseCase });\n`,
      `${composition} has 2 framework() chains`,
    ],
    [
      'no chain',
      (text: string) =>
        text.replace(/framework\(\{ family: AppUseCase \}\)/, 'AppUseCase'),
      `${composition} has no framework() chain`,
    ],
  ])(
    'refuses a composition with %s and prints the lines',
    async (_, edit, why) => {
      const app = await copy();
      await writeFile(
        join(app, composition),
        edit(await read(app, composition)),
      );
      const before = await files(app);
      const { code, stdout, stderr } = lattice(app, 'collection', 'notes');
      expect(code).toBe(1);
      expect(stderr).toBe(`lattice: ${why}\n`);
      expect(stdout).toContain(`
${composition}, with the imports:
import { Notes } from '../../domain/collections/notes.js';

${composition}, at the end of the framework() chain:
  .collection(Notes, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
`);
      expect(stdout).toContain(`
${events}, after the last collection's events:
  notesCreated: Notes.events.created,
  notesUpdated: Notes.events.updated,
  notesDeleted: Notes.events.deleted,
`);
      expect(stdout).toContain(`\n${collections}/notes.ts, a new file:\n`);
      expect(await files(app)).toEqual(before);
    },
  );

  it('exits 2 on an unknown flag', async () => {
    const app = await copy();
    const flag = lattice(app, 'collection', 'notes', '--force');
    expect(flag.code).toBe(2);
    expect(flag.stderr).toBe(
      "lattice: Unknown option '--force'\nUsage: lattice collection <slug> [--tenant <field> | --global] [--label <singular>,<plural>] [--dry-run]\n",
    );
  });

  it.each([
    ['invalid JSON', '{', 'package.json is not valid JSON: '],
    [
      'an unknown key',
      { lattice: { tenat: 'x' } },
      'unknown key "lattice.tenat" in package.json',
    ],
    [
      'a value that is not a string',
      { lattice: { tenant: 1 } },
      '"lattice.tenant" in package.json must be a non-empty string',
    ],
    [
      'an empty tenant',
      { lattice: { tenant: '' } },
      '"lattice.tenant" in package.json must be a non-empty string',
    ],
    [
      'a reserved tenant',
      { lattice: { tenant: 'id' } },
      '"lattice.tenant" in package.json: "id" is a reserved field name',
    ],
    [
      'no tenant',
      {},
      'name the tenant field with --tenant <field>, or pass --global',
    ],
    [
      'a path outside the app',
      { lattice: { tenant: 'organizationId', collections: '../outside' } },
      '"lattice.collections" in package.json must be a path inside the app, not ../outside',
    ],
    [
      'an absolute path',
      { lattice: { tenant: 'organizationId', events: '/etc/hosts' } },
      '"lattice.events" in package.json must be a path inside the app, not /etc/hosts',
    ],
    [
      'a missing path',
      { lattice: { tenant: 'organizationId', events: 'src/nope.ts' } },
      `src/nope.ts does not exist: set "lattice.events" in package.json to the app's file`,
    ],
    [
      'a file for a directory',
      { lattice: { tenant: 'organizationId', collections: 'package.json' } },
      '"lattice.collections" in package.json must be a directory: package.json',
    ],
  ])('exits 2 on a config with %s', async (_, manifest, why) => {
    const app = await copy();
    await writeFile(
      join(app, 'package.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
    const before = await files(app);
    const { code, stderr } = lattice(app, 'collection', 'notes');
    expect(stderr).toContain(`lattice: ${why}`);
    expect(code).toBe(2);
    expect(await files(app)).toEqual(before);
  });

  it('lists the commands on --help', async () => {
    const { code, stdout } = lattice(fixture, '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('collection <slug>');
  });

  it('keeps comments where they are at every insertion point', async () => {
    const app = await copy();
    const contacts =
      "import { Contacts } from '../../domain/collections/contacts.js';";
    const chainEnd =
      '  .collection(Contacts, {\n    access: { read: anyone, create: anyone, update: anyone, delete: anyone },\n  });';
    await edit(app, composition, (text) =>
      text
        .replace(contacts, `${contacts} // CRM contacts`)
        .replace(chainEnd, `${chainEnd.slice(0, -1)} // the last one\n  ;`),
    );
    const deleted = '  contactsDeleted: Contacts.events.deleted,';
    await edit(app, events, (text) =>
      text.replace(deleted, `${deleted} // contacts, done`),
    );
    expect(lattice(app, 'collection', 'notes').code).toBe(0);
    expect(await read(app, composition)).toContain(
      `${contacts} // CRM contacts\nimport { Notes } from '../../domain/collections/notes.js';\n`,
    );
    expect(await read(app, composition)).toContain(
      `  }) // the last one\n  .collection(Notes, {\n    access: { read: anyone, create: anyone, update: anyone, delete: anyone },\n  })\n  ;\n`,
    );
    expect(await read(app, events)).toContain(
      `${deleted} // contacts, done\n  notesCreated: Notes.events.created,\n`,
    );
  });

  it.each([
    [
      'no trailing comma and a comma in a comment',
      '  contactsDeleted: Contacts.events.deleted // a, b\n',
      '  contactsDeleted: Contacts.events.deleted, // a, b\n  notesCreated: Notes.events.created,\n  notesUpdated: Notes.events.updated,\n  notesDeleted: Notes.events.deleted\n',
    ],
    [
      'a trailing comma and a comment',
      '  contactsDeleted: Contacts.events.deleted, // last\n',
      '  contactsDeleted: Contacts.events.deleted, // last\n  notesCreated: Notes.events.created,\n  notesUpdated: Notes.events.updated,\n  notesDeleted: Notes.events.deleted,\n',
    ],
  ])('adds events after a last entry with %s', async (_, last, expected) => {
    const app = await copy();
    await edit(app, events, (text) =>
      text.replace(/ {2}contactsDeleted:[\s\S]*\}\) \{\}/, `${last}}) {}`),
    );
    expect(lattice(app, 'collection', 'notes').code).toBe(0);
    expect(await read(app, events)).toContain(`${expected}}) {}\n`);
  });

  it('writes CRLF into a CRLF file, and tabs into a tab-indented one', async () => {
    const plain = await copy();
    expect(lattice(plain, 'collection', 'notes').code).toBe(0);

    const tabs = (text: string) =>
      text.replace(/^( {2})+/gm, (lead) => '\t'.repeat(lead.length / 2));
    const crlf = (text: string) => text.replaceAll('\n', '\r\n');
    for (const style of [crlf, tabs]) {
      const app = await copy();
      await edit(app, composition, style);
      await edit(app, events, style);
      expect(lattice(app, 'collection', 'notes').code).toBe(0);
      for (const file of [composition, events]) {
        expect(await read(app, file)).toBe(style(await read(plain, file)));
      }
    }
  });

  it('indents a link added to a chain on one line by one unit', async () => {
    const app = await copy();
    await edit(app, composition, (text) =>
      text.replace(
        /export const api = [\s\S]*;\n$/,
        'export const api = framework({ family: AppUseCase }).collection(Companies, { access: {} });\n',
      ),
    );
    expect(lattice(app, 'collection', 'notes').code).toBe(0);
    expect(await read(app, composition)).toContain(
      'export const api = framework({ family: AppUseCase }).collection(Companies, { access: {} })\n  .collection(Notes, {\n    access: { read: anyone, create: anyone, update: anyone, delete: anyone },\n  });\n',
    );
  });

  it.each([
    ['an events file', events],
    ['a collections directory', collections],
  ])('writes nothing when %s is read-only', async (_, target) => {
    const app = await copy();
    const before = await files(app);
    const path = join(app, target);
    const mode = (await stat(path)).mode;
    await chmod(path, target === events ? 0o444 : 0o555);
    try {
      const { code, stderr } = lattice(app, 'collection', 'notes');
      expect(stderr).toBe(
        `lattice: cannot write ${target === events ? events : `${collections}/notes.ts`} (EACCES); nothing was written\n`,
      );
      expect(code).toBe(1);
    } finally {
      await chmod(path, mode);
    }
    expect(await files(app)).toEqual(before);
  });

  it.each([
    [
      'a name the events file declares',
      'domain_events',
      undefined,
      `${events} already declares DomainEvents`,
    ],
    [
      'a name the composition declares',
      'notes',
      (text: string) => `${text}\nexport const Notes = 1;\n`,
      `${composition} already declares Notes`,
    ],
    [
      'a name the composition imports',
      'notes',
      (text: string) =>
        `import { Notes } from '../../domain/collections/old-notes.js';\n${text}`,
      `${composition} already imports Notes`,
    ],
    [
      'a collection the composition registers',
      'notes',
      (text: string) =>
        text.replace(/;\n$/, '\n  .collection(Notes, { access: {} });\n'),
      `${composition} already registers Notes`,
    ],
  ])('refuses %s', async (_, slug, change, why) => {
    const app = await copy();
    if (change !== undefined) await edit(app, composition, change);
    const before = await files(app);
    expect(lattice(app, 'collection', slug)).toEqual({
      code: 1,
      stdout: '',
      stderr: `lattice: ${why}\n`,
    });
    expect(await files(app)).toEqual(before);
  });

  it('refuses events the catalog already lists', async () => {
    const app = await copy();
    await edit(app, events, (text) =>
      text.replace(
        '  companiesCreated:',
        '  notesCreated: Companies.events.created,\n  companiesCreated:',
      ),
    );
    const { code, stderr } = lattice(app, 'collection', 'notes');
    expect(stderr).toBe(`lattice: ${events} already lists notesCreated\n`);
    expect(code).toBe(1);
  });

  it.each([
    [
      'no EventCatalog()',
      (text: string) => text.replace('extends EventCatalog(', 'extends Base('),
      `${events} has no EventCatalog()`,
    ],
    [
      'two',
      (text: string) =>
        `${text}export class Other extends EventCatalog('other', {}) {}\n`,
      `${events} has 2 EventCatalog() calls`,
    ],
    [
      'no object literal',
      (text: string) =>
        text
          .replace("EventCatalog('domain-events', {", 'const entries = {')
          .replace(
            '}) {}',
            "};\nexport class DomainEvents extends EventCatalog('domain-events', entries) {}",
          ),
      `the EventCatalog() in ${events} has no object literal of events`,
    ],
  ])(
    'refuses an events file with %s and prints the lines',
    async (_, change, why) => {
      const app = await copy();
      await edit(app, events, change);
      const before = await files(app);
      const { code, stdout, stderr } = lattice(app, 'collection', 'notes');
      expect(stderr).toBe(`lattice: ${why}\n`);
      expect(code).toBe(1);
      expect(stdout).toContain(
        `${events}, after the last collection's events:\n  notesCreated: Notes.events.created,\n`,
      );
      expect(await files(app)).toEqual(before);
    },
  );

  it('finds a slug in any TypeScript file, by an aliased import', async () => {
    const app = await copy();
    await writeFile(
      join(app, collections, 'extra.mts'),
      "import { collection as define } from '@latticecms/core';\nimport { z } from 'zod';\n\nexport const Extra = define('notes', { schema: z.object({}) });\n",
    );
    expect(lattice(app, 'collection', 'notes').stderr).toBe(
      `lattice: "notes" is a collection in ${collections}/extra.mts\n`,
    );
  });

  it('refuses a TypeScript older than 5.8', async () => {
    const app = await copy();
    const fake = join(app, 'node_modules/typescript');
    await mkdir(fake, { recursive: true });
    await writeFile(
      join(fake, 'package.json'),
      '{ "name": "typescript", "version": "5.4.5", "main": "index.js" }',
    );
    await writeFile(
      join(fake, 'index.js'),
      "module.exports = { createSourceFile() {}, versionMajorMinor: '5.4' };\n",
    );
    const { code, stderr } = lattice(app, 'collection', 'notes');
    expect(stderr).toMatch(
      /^lattice: typescript 5\.4 in .+ is too old: lattice needs 5\.8 or later\n$/,
    );
    expect(code).toBe(1);
  });

  it('refuses TypeScript 7, which has no JavaScript API', async () => {
    const app = await copy();
    const fake = join(app, 'node_modules/typescript');
    await mkdir(fake, { recursive: true });
    // What typescript@7's main entry exports: its version, and no compiler.
    await writeFile(
      join(fake, 'package.json'),
      '{ "name": "typescript", "version": "7.0.2", "main": "index.js" }',
    );
    await writeFile(
      join(fake, 'index.js'),
      "module.exports = { version: '7.0.2', versionMajorMinor: '7.0' };\n",
    );
    const { code, stderr } = lattice(app, 'collection', 'notes');
    expect(stderr).toMatch(
      /^lattice: typescript 7\.0 in .+ is the native compiler, which has no JavaScript API to parse files with: run npm install --save-dev typescript@\^6\n$/,
    );
    expect(code).toBe(1);
  });

  it('stops quietly when its reader closes the pipe', async () => {
    const app = await copy();
    const errors = join(app, 'errors.txt');
    const { status } = spawnSync(
      'sh',
      [
        '-c',
        '"$0" "$1" collection notes --dry-run 2>"$2" | true',
        process.execPath,
        bin,
        errors,
      ],
      { cwd: app, env },
    );
    expect(status).toBe(0);
    expect(await readFile(errors, 'utf8')).toBe('');
  });

  it('adds a collection to the crm with its defaults', async () => {
    const app = await crmCopy();
    const { code, stdout } = lattice(app, 'collection', 'notes');
    expect(stdout).toContain(`created ${collections}/notes.ts\n`);
    expect(code).toBe(0);
    expect(await read(app, `${collections}/notes.ts`)).toContain(
      "tenant: 'organizationId',",
    );
    // A long slug and label, whose lines break as Biome breaks them.
    const long = 'customer_support_ticket_attachments';
    const longFile = 'customer-support-ticket-attachments';
    expect(
      lattice(
        app,
        'collection',
        long,
        '--label',
        'customer support ticket attachment,customer support ticket attachments',
      ).code,
    ).toBe(0);
    await check(app, 'tsconfig.check.json', [
      `${collections}/notes.test.ts`,
      `${collections}/${longFile}.test.ts`,
    ]);
    // The edits keep the crm's own formatting and import order.
    const biome = run(app, [
      join(repo, 'node_modules/@biomejs/biome/bin/biome'),
      'check',
      `--config-path=${join(repo, 'biome.json')}`,
      `${collections}/notes.ts`,
      `${collections}/notes.test.ts`,
      `${collections}/${longFile}.ts`,
      `${collections}/${longFile}.test.ts`,
      composition,
      events,
    ]);
    expect(biome.stderr).toContain('Checked 6 files');
    expect(biome.code).toBe(0);
  });
});
