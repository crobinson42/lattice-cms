import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase } from './fixtures/context.js';
import {
  collection,
  type Doc,
  family,
  framework,
  MemoryStore,
  ref,
  tenancy,
  unscoped,
  type Where,
} from './index.js';

const Tenanted = family({
  actor: z.object({ userId: z.string(), organizationId: z.string() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});

const tenant = 'organizationId';

const Countries = collection('countries', {
  schema: z.object({ name: z.string() }),
});
const Companies = collection('companies', {
  schema: z.object({
    name: z.string(),
    countryId: ref('countries').optional(),
  }),
  tenant,
});
const Contacts = collection('contacts', {
  schema: z.object({ name: z.string(), companyId: ref('companies') }),
  tenant,
});
const Projects = collection('projects', {
  schema: z.object({
    name: z.string(),
    companyId: ref('companies', { onDelete: 'cascade' }).min(1),
  }),
  tenant,
});
const Tasks = collection('tasks', {
  schema: z.object({
    name: z.string(),
    projectId: ref('projects', { onDelete: 'cascade' }),
    // A cycle: a task can point at another task, which points back.
    parentId: ref('tasks', { onDelete: 'cascade' }).optional(),
  }),
  tenant,
});
const Invoices = collection('invoices', {
  schema: z.object({ taskId: ref('tasks') }),
  tenant,
});
const Notes = collection('notes', {
  schema: z.object({
    text: z.string(),
    companyId: ref('companies', { onDelete: 'nullify' }).optional(),
    projectId: ref('projects', { onDelete: 'nullify' }).nullable(),
  }),
  tenant,
});
const Labels = collection('labels', {
  schema: z.object({
    name: z.string(),
    companyIds: z.array(ref('companies', { onDelete: 'nullify' })),
  }),
  tenant,
});

const all = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/** The code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

type Published = { token: string; payload: Record<string, unknown> };

function setup() {
  const store = new MemoryStore();
  const published: Published[] = [];
  const seen: string[] = [];
  const events = {
    async publish(event: object) {
      if (!('payload' in event) || !('token' in event)) return;
      const { payload, token } = event;
      if (
        typeof token !== 'string' ||
        typeof payload !== 'object' ||
        payload === null
      )
        return;
      published.push({ token, payload: { ...payload } });
      // What the store holds when the event goes out: after the commit.
      seen.push(`${token}:${await store.count('companies')}`);
    },
  };
  const built = framework({ family: Tenanted })
    .collection(Countries, { access: all })
    .collection(Companies, { access: all })
    .collection(Contacts, { access: all })
    .collection(Projects, { access: all })
    .collection(Tasks, { access: all })
    .collection(Invoices, { access: all })
    .collection(Notes, { access: all })
    .collection(Labels, { access: all })
    .build({ store, events });
  const client = (organizationId: string) =>
    createLocalClient(built.app, {
      context: {
        actor: { userId: 'u1', organizationId },
        logger: new MemoryLogger(),
      },
    });
  return { ...built, store, published, seen, a: client('A'), b: client('B') };
}

describe('ref()', () => {
  it('keeps its target through clones and wrappers', () => {
    const Items = collection('items', {
      schema: z.object({
        ownerId: ref('users').min(1).optional(),
        tagIds: z.array(ref('tags', { onDelete: 'nullify' }).min(1)).max(5),
        plain: z.string(),
      }),
    });
    expect(Items.refs).toEqual([
      {
        field: 'ownerId',
        slug: 'users',
        onDelete: 'restrict',
        array: false,
        cleared: undefined,
      },
      {
        field: 'tagIds',
        slug: 'tags',
        onDelete: 'nullify',
        array: true,
        cleared: null,
      },
    ]);
    expect(
      Items.schema.parse({ ownerId: 'u', tagIds: ['t'], plain: 'p' }),
    ).toEqual({
      ownerId: 'u',
      tagIds: ['t'],
      plain: 'p',
    });
    expect(() => Items.schema.parse({ tagIds: [''], plain: 'p' })).toThrow();
  });

  it('gives each ref an index, led by the tenant field, unless one is declared', () => {
    expect(Projects.indexes).toEqual([
      { fields: { organizationId: 1, companyId: 1 } },
    ]);
    expect(Countries.indexes).toEqual([]);
    const Declared = collection('declared', {
      schema: z.object({ ownerId: ref('users') }),
      indexes: [{ fields: { ownerId: 1 }, unique: true }],
    });
    expect(Declared.indexes).toEqual([
      { fields: { ownerId: 1 }, unique: true },
    ]);
  });

  it('a list of ids takes has in Where', () => {
    expectTypeOf<Where<Doc<typeof Labels>>['companyIds']>().toEqualTypeOf<
      { readonly has?: string; readonly exists?: boolean } | undefined
    >();
  });
});

describe('onDelete', () => {
  async function seeded() {
    const s = setup();
    const { repos } = s;
    const scoped = (org: string) => ({
      companies: tenancy.scope(Companies, org),
      contacts: tenancy.scope(Contacts, org),
      projects: tenancy.scope(Projects, org),
      tasks: tenancy.scope(Tasks, org),
      invoices: tenancy.scope(Invoices, org),
      notes: tenancy.scope(Notes, org),
      labels: tenancy.scope(Labels, org),
    });
    const A = scoped('A');
    const acme = await repos.companies.insert({ name: 'Acme' }, A.companies);
    const other = await repos.companies.insert({ name: 'Other' }, A.companies);
    const p1 = await repos.projects.insert(
      { name: 'p1', companyId: acme.id },
      A.projects,
    );
    const p2 = await repos.projects.insert(
      { name: 'p2', companyId: acme.id },
      A.projects,
    );
    const t1 = await repos.tasks.insert(
      { name: 't1', projectId: p1.id },
      A.tasks,
    );
    // t2 is t1's child, and t1 is set to point back at t2: a cycle.
    const t2 = await repos.tasks.insert(
      { name: 't2', projectId: p2.id, parentId: t1.id },
      A.tasks,
    );
    await repos.tasks.update(t1.id, { parentId: t2.id }, A.tasks);
    const note = await repos.notes.insert(
      { text: 'n', companyId: acme.id, projectId: p1.id },
      A.notes,
    );
    const label = await repos.labels.insert(
      { name: 'l', companyIds: [acme.id, other.id] },
      A.labels,
    );
    return { ...s, A, scoped, acme, other, p1, p2, t1, t2, note, label };
  }

  it('cascades through every level, stops at a cycle, and nullifies refs', async () => {
    const { a, repos, acme, p1, p2, t1, t2, note, label } = await seeded();

    await a.companies.delete({ id: acme.id });

    expect(await repos.companies.get(acme.id, unscoped)).toBeNull();
    expect(await repos.projects.getMany([p1.id, p2.id], unscoped)).toEqual([]);
    expect(await repos.tasks.getMany([t1.id, t2.id], unscoped)).toEqual([]);
    const cleared = await repos.notes.get(note.id, unscoped);
    expect(cleared).not.toHaveProperty('companyId');
    // The project's delete clears the nullable projectId to null.
    expect(cleared?.projectId).toBeNull();
    expect((await repos.labels.get(label.id, unscoped))?.companyIds).toEqual(
      label.companyIds.filter((id) => id !== acme.id),
    );
  });

  it('publishes each child’s event after the commit, and the parent’s last', async () => {
    const { a, acme, published, seen } = await seeded();

    await a.companies.delete({ id: acme.id });

    const tokens = published.map(({ token }) => token);
    expect(tokens.at(-1)).toBe('companies.deleted');
    expect(tokens.filter((t) => t === 'tasks.deleted')).toHaveLength(2);
    expect(tokens.filter((t) => t === 'projects.deleted')).toHaveLength(2);
    expect(tokens.filter((t) => t === 'notes.updated')).toHaveLength(2);
    expect(tokens.filter((t) => t === 'labels.updated')).toHaveLength(1);
    // Every event saw the company already gone: one left, Other.
    expect(seen.every((entry) => entry.endsWith(':1'))).toBe(true);
    expect(
      published.find(({ token }) => token === 'tasks.deleted')?.payload,
    ).toMatchObject({
      actorId: 'u1',
      tenantId: 'A',
    });
  });

  it('restrict refuses with REFERENCED, naming the referring field', async () => {
    const { a, repos, A, other } = await seeded();
    await repos.contacts.insert({ name: 'c', companyId: other.id }, A.contacts);

    const error = await a.companies
      .delete({ id: other.id })
      .catch((caught: unknown) => caught);

    expect(
      isPFError(error) && error.code === 'REFERENCED' && error.status,
    ).toBe(409);
    expect(isPFError(error) && error.data).toEqual({
      collection: 'companies',
      id: other.id,
      by: { collection: 'contacts', field: 'companyId' },
    });
    expect(await repos.companies.get(other.id, unscoped)).not.toBeNull();
  });

  it('a restrict deep in a cascade rolls everything back, and publishes nothing', async () => {
    const { a, repos, A, acme, p1, t2, note, label, published } =
      await seeded();
    await repos.invoices.insert({ taskId: t2.id }, A.invoices);

    const error = await a.companies
      .delete({ id: acme.id })
      .catch((caught: unknown) => caught);

    expect(isPFError(error) && error.data).toEqual({
      collection: 'tasks',
      id: t2.id,
      by: { collection: 'invoices', field: 'taskId' },
    });
    expect(await repos.companies.get(acme.id, unscoped)).not.toBeNull();
    expect(await repos.projects.get(p1.id, unscoped)).not.toBeNull();
    expect(await repos.tasks.get(t2.id, unscoped)).not.toBeNull();
    expect(await repos.notes.get(note.id, unscoped)).toEqual(note);
    expect(await repos.labels.get(label.id, unscoped)).toEqual(label);
    expect(published).toEqual([]);
  });

  it('a failure while applying rolls the whole delete back', async () => {
    const { a, repos, store, A, acme, p1, p2, note, published } =
      await seeded();
    // Two notes whose nullable projectId both become null clash on a unique index.
    await store.ensure('notes', [{ fields: { projectId: 1 }, unique: true }]);
    const n2 = await repos.notes.insert(
      { text: 'n2', projectId: p2.id },
      A.notes,
    );

    expect(await codeOf(a.companies.delete({ id: acme.id }))).toBe('CONFLICT');

    expect(await repos.companies.get(acme.id, unscoped)).not.toBeNull();
    expect(await repos.projects.getMany([p1.id, p2.id], unscoped)).toHaveLength(
      2,
    );
    // Neither note keeps a nullified projectId, whichever was written first.
    expect(await repos.notes.getMany([note.id, n2.id], unscoped)).toEqual([
      note,
      n2,
    ]);
    expect(published).toEqual([]);
  });

  it('stays in the parent’s tenant: another tenant’s row with this id neither blocks nor is cascaded', async () => {
    const { a, repos, scoped, other } = await seeded();
    const B = scoped('B');
    // Writes do not check existence, so tenant B can store A's company id.
    const contact = await repos.contacts.insert(
      { name: 'b', companyId: other.id },
      B.contacts,
    );
    const project = await repos.projects.insert(
      { name: 'b', companyId: other.id },
      B.projects,
    );

    await a.companies.delete({ id: other.id });

    expect(await repos.companies.get(other.id, unscoped)).toBeNull();
    expect(await repos.contacts.get(contact.id, unscoped)).toEqual(contact);
    expect(await repos.projects.get(project.id, unscoped)).toEqual(project);
  });

  it('a global parent’s children are found across tenants', async () => {
    const { a, repos, scoped } = await seeded();
    const country = await repos.countries.insert({ name: 'Nowhere' }, unscoped);
    await repos.companies.insert(
      { name: 'b', countryId: country.id },
      scoped('B').companies,
    );

    expect(await codeOf(a.countries.delete({ id: country.id }))).toBe(
      'REFERENCED',
    );

    const empty = await repos.countries.insert({ name: 'Empty' }, unscoped);
    expect(await codeOf(a.countries.delete({ id: empty.id }))).toBe('ok');
  });

  it('runs only in the generated delete: not in Repo.remove', async () => {
    const { repos, acme, p1 } = await seeded();

    await repos.companies.remove(acme.id, unscoped);

    expect(await repos.projects.get(p1.id, unscoped)).not.toBeNull();
  });

  it('does not run in an override of delete', async () => {
    class Archive extends AppUseCase('countries.delete', {
      collection: Countries,
    }) {
      async execute() {
        return { id: 'x', name: 'kept', createdAt: '', updatedAt: '' };
      }
    }
    const store = new MemoryStore();
    const { app, repos } = framework({ family: AppUseCase })
      .collection(Countries, { access: all, overrides: { delete: Archive } })
      .collection(
        collection('cities', {
          schema: z.object({ countryId: ref('countries') }),
        }),
        {
          access: all,
        },
      )
      .build({
        store,
        events: { publish: async (_event: object) => {} },
        overrides: () => ({ countries: { delete: new Archive() } }),
      });
    const country = await repos.countries.insert({ name: 'c' }, unscoped);
    await repos.cities.insert({ countryId: country.id }, unscoped);
    const local = createLocalClient(app, {
      context: {
        actor: { userId: 'u1', roles: [] },
        logger: new MemoryLogger(),
      },
    });

    expect(await codeOf(local.countries.delete({ id: country.id }))).toBe('ok');
  });
});

describe('definition checks', () => {
  /** Statements the compiler checks and the test never runs. */
  function typeOnly(_statements: () => unknown): void {}

  it('nullify on a required ref is a compile error and a throw', () => {
    expect(() =>
      // @ts-expect-error "companyId" is required; nullify needs it .optional() or .nullable()
      collection('x', {
        schema: z.object({
          companyId: ref('companies', { onDelete: 'nullify' }),
        }),
      }),
    ).toThrow(
      '"x.companyId" is required; nullify needs it .optional() or .nullable()',
    );
  });

  it('cascade on a list of ids is a compile error and a throw', () => {
    expect(() =>
      // @ts-expect-error "tagIds" is a list of ids; it cannot cascade (use restrict or nullify)
      collection('x', {
        schema: z.object({
          tagIds: z.array(ref('tags', { onDelete: 'cascade' })),
        }),
      }),
    ).toThrow('"x.tagIds" is a list of ids; it cannot cascade');
  });

  it('a cascade into a collection that overrides delete is a compile error and a throw', () => {
    const Deals = collection('deals', {
      schema: z.object({
        companyId: ref('companies', { onDelete: 'cascade' }),
      }),
    });
    class ArchiveDeal extends AppUseCase('deals.delete', {
      collection: Deals,
    }) {
      async execute() {
        return { id: 'd', companyId: 'c', createdAt: '', updatedAt: '' };
      }
    }
    expect(() =>
      // @ts-expect-error deals overrides delete, so deals.companyId cannot cascade; use restrict or nullify
      framework({ family: AppUseCase }).collection(Deals, {
        access: all,
        overrides: { delete: ArchiveDeal },
      }),
    ).toThrow(
      'deals overrides delete, so deals.companyId cannot cascade; use restrict or nullify',
    );
    // Restrict and nullify keep the soft-deleted row, so they are fine.
    const Kept = collection('deals', {
      schema: z.object({ companyId: ref('companies') }),
    });
    class ArchiveKept extends AppUseCase('deals.delete', { collection: Kept }) {
      async execute() {
        return { id: 'd', companyId: 'c', createdAt: '', updatedAt: '' };
      }
    }
    expect(
      Object.keys(
        framework({ family: AppUseCase })
          .collection(collection('companies', { schema: z.object({}) }), {
            access: all,
          })
          .collection(Kept, { access: all, overrides: { delete: ArchiveKept } })
          .contract,
      ),
    ).toEqual(['companies', 'deals']);
  });

  it('a ref to a slug the framework lacks fails build() and contract', () => {
    const Orphans = collection('orphans', {
      schema: z.object({ ownerId: ref('owners') }),
    });
    const definition = framework({ family: AppUseCase }).collection(Orphans, {
      access: all,
    });

    expect(() =>
      definition.build({
        // @ts-expect-error orphans.ownerId refers to "owners", which is not a collection of this framework
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
      }),
    ).toThrow(
      'orphans.ownerId refers to "owners", which is not a collection of this framework',
    );
    expect(() => definition.contract).toThrow(
      'orphans.ownerId refers to "owners"',
    );
    typeOnly(() => {
      expectTypeOf(
        definition.contract['~error'],
      ).toEqualTypeOf<'orphans.ownerId refers to "owners", which is not a collection of this framework'>();
    });
  });

  it('refs may point both ways: mutual refs resolve once both are added', () => {
    const Users = collection('users', {
      schema: z.object({ pinnedPostId: ref('posts').optional() }),
    });
    const Posts = collection('posts', {
      schema: z.object({ authorId: ref('users') }),
    });
    const definition = framework({ family: AppUseCase })
      .collection(Posts, { access: all })
      .collection(Users, { access: all });
    expect(Object.keys(definition.contract)).toEqual(['posts', 'users']);
  });
});
