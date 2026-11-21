import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import type { UseCase } from 'hexok';
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
  type Repo,
  tenancy,
  unscoped,
} from './index.js';

const Tenanted = family({
  actor: z.object({
    userId: z.string(),
    organizationId: z.string(),
    support: z.boolean().optional(),
  }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

const Notes = collection('notes', {
  schema: z.object({ title: z.string(), rank: z.number() }),
  tenant: 'organizationId',
});

/** A global collection: no tenant field. */
const Labels = collection('labels', { schema: z.object({ name: z.string() }) });

type Note = Doc<typeof Notes>;

/** Raises a note's rank through its repo, under the method's scope. */
class TouchNote extends Tenanted('notes.touch', {
  collection: Notes,
  input: z.object({ id: z.string() }),
  output: Notes.output,
}) {
  constructor(private readonly deps: { notes: Repo<typeof Notes> }) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof Tenanted>,
    input: { id: string },
  ): Promise<Note> {
    const scope = await ctx.access.scope(Notes, 'touch');
    const note = await this.deps.notes.get(input.id, scope);
    if (note === null) throw notFound(input.id);
    const touched = await this.deps.notes.update(
      input.id,
      { rank: note.rank + 1 },
      scope,
    );
    if (touched === null) throw notFound(input.id);
    return touched;
  }
}

/** Copies a note: an insert through the method's scope is stamped. */
class CopyNote extends Tenanted('notes.copy', {
  collection: Notes,
  input: z.object({ id: z.string() }),
  output: Notes.output,
}) {
  constructor(private readonly deps: { notes: Repo<typeof Notes> }) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof Tenanted>,
    input: { id: string },
  ): Promise<Note> {
    const scope = await ctx.access.scope(Notes, 'copy');
    const note = await this.deps.notes.get(input.id, scope);
    if (note === null) throw notFound(input.id);
    return this.deps.notes.insert(
      { title: note.title, rank: note.rank },
      scope,
    );
  }
}

function notFound(id: string) {
  return LatticeError.NOT_FOUND({ collection: Notes.slug, id });
}

/** The code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

const alice = { userId: 'a', organizationId: 'o1' };
const bob = { userId: 'b', organizationId: 'o2' };
const staff = { userId: 's', organizationId: 'o0', support: true };

function setup() {
  const logger = new MemoryLogger();
  const published: { token: string; payload: object }[] = [];
  const events = {
    async publish(event: object) {
      if ('payload' in event && typeof event.payload === 'object') {
        const token = event.constructor.name;
        published.push({ token, payload: event.payload ?? {} });
      }
    },
  };
  const built = framework({ family: Tenanted })
    .collection(Notes, {
      access: { ...open, touch: () => true, copy: () => true },
      methods: { touch: TouchNote, copy: CopyNote },
    })
    .collection(Labels, { access: open })
    .build({
      store: new MemoryStore(),
      events,
      methods: ({ repos }) => ({
        notes: {
          touch: new TouchNote({ notes: repos.notes }),
          copy: new CopyNote({ notes: repos.notes }),
        },
      }),
    });
  const as = (actor: typeof alice | typeof staff) =>
    createLocalClient(built.app, { context: { actor, logger } });
  return {
    ...built,
    logger,
    published,
    o1: as(alice),
    o2: as(bob),
    support: as(staff),
  };
}

/** Notes in tenant `organizationId`, inserted through its server scope. */
async function notesIn(
  repos: { readonly notes: Repo<typeof Notes> },
  organizationId: string,
  ranks: number[],
): Promise<Note[]> {
  const scope = tenancy.scope(Notes, organizationId);
  const notes: Note[] = [];
  for (const rank of ranks) {
    notes.push(
      await repos.notes.insert(
        { title: `${organizationId}-${rank}`, rank },
        scope,
      ),
    );
  }
  return notes;
}

describe('isolation', () => {
  it('create stamps the caller’s tenant, which the client cannot set', async () => {
    const { o1 } = setup();

    const note = await o1.notes.create({
      title: 't',
      rank: 1,
      // @ts-expect-error create input has no tenant field
      organizationId: 'o2',
    });

    expect(note.organizationId).toBe('o1');
    expectTypeOf(note.organizationId).toEqualTypeOf<string>();
  });

  it('find never reaches another tenant, across pages with ties', async () => {
    const { o1, repos } = setup();
    const own = await notesIn(repos, 'o1', [1, 1, 1, 2, 2]);
    await notesIn(repos, 'o2', [1, 1, 2, 2]);

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await o1.notes.find({
        sort: ['rank'],
        limit: 2,
        ...(after === undefined ? {} : { after }),
      });
      seen.push(...page.docs.map((doc) => doc.id));
      after = page.next ?? undefined;
    } while (after !== undefined);

    expect(seen.sort()).toEqual(own.map((note) => note.id).sort());
  });

  it('another tenant’s id is NOT_FOUND on get, update and delete', async () => {
    const { o1, repos } = setup();
    const [theirs] = await notesIn(repos, 'o2', [1]);
    const id = theirs?.id ?? '';

    expect(await codeOf(o1.notes.get({ id }))).toBe('NOT_FOUND');
    expect(await codeOf(o1.notes.update({ id, rank: 9 }))).toBe('NOT_FOUND');
    expect(await codeOf(o1.notes.delete({ id }))).toBe('NOT_FOUND');
    expect(await repos.notes.get(id, unscoped)).toEqual(theirs);
  });

  it('update keeps the tenant field, and a client cannot change it', async () => {
    const { o1, repos } = setup();
    const [note] = await notesIn(repos, 'o1', [1]);
    const id = note?.id ?? '';

    // @ts-expect-error update input has no tenant field
    await o1.notes.update({ id, title: 'renamed', organizationId: 'o2' });

    expect(await repos.notes.get(id, unscoped)).toMatchObject({
      title: 'renamed',
      organizationId: 'o1',
    });
  });

  it('update never writes a tenant a beforeChange hook returns', async () => {
    const Hooked = Notes.hooks({
      beforeChange: ({ data }) => ({ ...data, organizationId: 'o2' }),
    });
    const { app, repos } = framework({ family: Tenanted })
      .collection(Hooked, { access: open })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
      });
    const o1 = createLocalClient(app, {
      context: { actor: alice, logger: new MemoryLogger() },
    });

    const created = await o1.notes.create({ title: 't', rank: 1 });
    await o1.notes.update({ id: created.id, rank: 2 });

    expect(created.organizationId).toBe('o1');
    expect(await repos.notes.get(created.id, unscoped)).toMatchObject({
      rank: 2,
      organizationId: 'o1',
    });
  });

  it('a method’s repo calls stay in the caller’s tenant', async () => {
    const { o1, repos } = setup();
    const [own] = await notesIn(repos, 'o1', [1]);
    const [theirs] = await notesIn(repos, 'o2', [1]);

    expect(await o1.notes.touch({ id: own?.id ?? '' })).toMatchObject({
      rank: 2,
    });
    expect(await codeOf(o1.notes.touch({ id: theirs?.id ?? '' }))).toBe(
      'NOT_FOUND',
    );
    const copy = await o1.notes.copy({ id: own?.id ?? '' });
    expect(copy.organizationId).toBe('o1');
  });
});

describe('bypass', () => {
  it('reads across tenants, and can filter by the tenant field', async () => {
    const { support, repos } = setup();
    const [a] = await notesIn(repos, 'o1', [1]);
    const [b] = await notesIn(repos, 'o2', [2]);

    const all = await support.notes.find({ sort: ['rank'] });
    const o2 = await support.notes.find({
      where: { organizationId: { eq: 'o2' } },
    });

    expect(all.docs).toEqual([a, b]);
    expect(o2.docs).toEqual([b]);
    expect(await support.notes.get({ id: b?.id ?? '' })).toEqual(b);
  });

  it('cannot write: generated writes and repo writes are FORBIDDEN', async () => {
    const { support, repos } = setup();
    const [note] = await notesIn(repos, 'o1', [1]);
    const id = note?.id ?? '';

    expect(await codeOf(support.notes.create({ title: 't', rank: 1 }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(support.notes.update({ id, rank: 2 }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(support.notes.delete({ id }))).toBe('FORBIDDEN');
    expect(await codeOf(support.notes.touch({ id }))).toBe('FORBIDDEN');
    expect(await codeOf(support.notes.copy({ id }))).toBe('FORBIDDEN');
    expect(await repos.notes.get(id, unscoped)).toEqual(note);
  });

  it('logs each bypassed call with the actor, collection and action', async () => {
    const { support, logger } = setup();

    await support.notes.find({});

    expect(logger.records).toMatchObject([
      {
        level: 'info',
        message: 'tenancy.bypass',
        fields: {
          actorId: 's',
          collection: 'notes',
          action: 'find',
          tenancy: 'bypass',
        },
      },
      {
        level: 'info',
        message: 'notes.find',
        fields: { actorId: 's', tenancy: 'bypass', outcome: 'ok' },
      },
    ]);
  });
});

describe('server scopes', () => {
  it('tenancy.scope reads and writes one tenant, and stamps on insert', async () => {
    const { repos } = setup();
    const [theirs] = await notesIn(repos, 'o2', [1]);
    const o1 = tenancy.scope(Notes, 'o1');

    const inserted = await repos.notes.insert({ title: 't', rank: 1 }, o1);

    expect(inserted.organizationId).toBe('o1');
    expect((await repos.notes.find({}, o1)).docs).toEqual([inserted]);
    expect(await repos.notes.update(theirs?.id ?? '', { rank: 2 }, o1)).toBe(
      null,
    );
    expect(await repos.notes.remove(theirs?.id ?? '', o1)).toBe(null);
  });

  it('unscoped cannot insert into a tenanted collection', async () => {
    const { repos } = setup();

    // @ts-expect-error a tenanted insert needs a Scope, not unscoped
    const insert = repos.notes.insert({ title: 't', rank: 1 }, unscoped);

    await expect(insert).rejects.toThrow(
      'Lattice: "notes" is tenanted, so insert needs a scope with a tenant',
    );
  });

  it('unscoped reads every tenant', async () => {
    const { repos } = setup();
    await notesIn(repos, 'o1', [1]);
    await notesIn(repos, 'o2', [1]);

    expect((await repos.notes.find({}, unscoped)).docs).toHaveLength(2);
  });
});

describe('global collections', () => {
  it('have no tenant clause', async () => {
    const { o1, o2 } = setup();

    const label = await o1.labels.create({ name: 'red' });

    expect(label).not.toHaveProperty('organizationId');
    expect(await o2.labels.get({ id: label.id })).toEqual(label);
  });

  it('their events carry no tenantId', async () => {
    const { o1, published } = setup();

    await o1.labels.create({ name: 'red' });

    expect(published).toHaveLength(1);
    expect(published[0]?.payload).not.toHaveProperty('tenantId');
    expectTypeOf<
      InstanceType<typeof Labels.events.created>['payload']
    >().not.toHaveProperty('tenantId');
  });
});

describe('events and logs', () => {
  it('a tenanted collection’s events carry tenantId', async () => {
    const { o1, published } = setup();

    const note = await o1.notes.create({ title: 't', rank: 1 });
    await o1.notes.update({ id: note.id, rank: 2 });
    await o1.notes.delete({ id: note.id });

    expect(published.map(({ payload }) => payload)).toMatchObject([
      { tenantId: 'o1' },
      { tenantId: 'o1' },
      { tenantId: 'o1' },
    ]);
    expectTypeOf<
      InstanceType<typeof Notes.events.created>['payload']['tenantId']
    >().toEqualTypeOf<string>();
  });

  it('log lines carry tenantId', async () => {
    const { o1, logger } = setup();

    await o1.notes.find({});
    await codeOf(o1.notes.get({ id: 'nope' }));

    expect(logger.records).toMatchObject([
      { fields: { tenantId: 'o1', outcome: 'ok' } },
      { fields: { tenantId: 'o1', outcome: 'refused', code: 'NOT_FOUND' } },
    ]);
  });
});

describe('a tenantOf that returns no tenant', () => {
  /** A framework whose family's tenantOf returns `tenant` for every actor. */
  function withTenant(tenant: string) {
    const Broken = family({
      actor: z.object({ userId: z.string() }),
      actorId: (actor) => actor.userId,
      tenantOf: () => tenant,
    });
    const { app, repos } = framework({ family: Broken })
      .collection(Notes, { access: open })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
      });
    const local = createLocalClient(app, {
      context: { actor: { userId: 'u' }, logger: new MemoryLogger() },
    });
    return { local, repos };
  }

  it.each([
    ['an empty string', '', 'tenantOf returned "" for "notes"'],
    // A JavaScript caller or a loose actor schema: JSON.parse is untyped.
    ['null', JSON.parse('null'), 'tenantOf returned null for "notes"'],
  ])(
    'fails closed on %s, and writes nothing',
    async (_name, tenant, message) => {
      const { local, repos } = withTenant(tenant);

      await expect(local.notes.create({ title: 't', rank: 1 })).rejects.toThrow(
        message,
      );
      await expect(local.notes.find({})).rejects.toThrow(message);
      expect((await repos.notes.find({}, unscoped)).docs).toEqual([]);
    },
  );
});

describe('type errors and throws', () => {
  /** Statements the compiler checks and the test never runs. */
  function typeOnly(_statements: () => unknown): void {}

  it('a tenant field in the schema', () => {
    expect(() =>
      // @ts-expect-error tenant "organizationId" is stamped by Lattice; it cannot be a schema field, a reserved name or an invalid field name
      collection('pages', {
        schema: z.object({ organizationId: z.string() }),
        tenant: 'organizationId',
      }),
    ).toThrow('tenant "organizationId" is stamped by Lattice');
  });

  it('a tenanted collection in a family without tenantOf', () => {
    expect(() =>
      framework({ family: AppUseCase }).collection(
        // @ts-expect-error "notes" is tenanted, but the family has no tenantOf
        Notes,
        { access: open },
      ),
    ).toThrow('"notes" is tenanted, but the family has no tenantOf');
  });

  it('tenancy.scope on a global collection', () => {
    typeOnly(() =>
      // @ts-expect-error tenancy.scope takes a tenanted collection
      tenancy.scope(Labels, 'o1'),
    );
  });
});
