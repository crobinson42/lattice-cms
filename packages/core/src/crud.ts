import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import { CallAccess } from './access.js';
import type {
  Action,
  AnyCollection,
  AnyRelation,
  ChangeArgs,
  Data,
  Document,
  Events,
  Operations,
} from './collection.js';
import { maxLinks } from './collection.js';
import { LatticeError, parse } from './errors.js';
import type { Family, FamilyContext } from './family.js';
import { refuseWithheld } from './mask.js';
import { linkFields, type PopulateInput } from './populate.js';
import type { Referrers, RefField } from './relations.js';
import { findQuery, stamped, touched } from './repo.js';
import type { CollectionStore, StoredDoc } from './store.js';
import { tenantClause, withoutTenant } from './tenancy.js';
import { type AnyWhere, both } from './where.js';

type AnyShape = z.core.$ZodShape;

// The payload of each event. AnyCollection's event classes take any payload,
// so each one is checked against its schema type with `satisfies`.
type Payload<Name extends keyof Events<string, AnyShape>> = InstanceType<
  Events<string, AnyShape>[Name]
>['payload'];

/** A use case as build() calls it. */
export type Executable<Ctx> = {
  execute(ctx: Ctx, input: unknown): Promise<unknown>;
};

/**
 * The app's event publisher, such as app-template's `DomainEventPublisher`.
 * `publish` is a method signature, so its parameter is bivariant: a publisher
 * typed by any catalog fits here. `.collection()` checks that it takes that
 * collection's events.
 */
export type EventPublisher = { publish(event: object): Promise<void> };

/** What one generated call works with. */
type Call = {
  readonly store: CollectionStore;
  readonly events: EventPublisher;
  readonly collection: AnyCollection;
  readonly ops: Operations<AnyShape>;
  /** The access and tenant filter of this call, for every store call. */
  readonly scope: AnyWhere | undefined;
  /** What a read's `populate` may name: the schema of that one field. */
  readonly populate: PopulateInput;
  readonly actorId: string;
  /** The call's tenant on this collection: what create stamps and events carry. */
  readonly tenantId: string | undefined;
  /** Who refers to each collection, for onDelete. */
  readonly referrers: Referrers;
  /** The call's access, for the collections a read populates. */
  readonly access: CallAccess;
  /** Every collection, by slug: what a populated ref reads. */
  readonly collections: ReadonlyMap<string, AnyCollection>;
};

/**
 * The filter that limits what a call may see and change (0005): the call's
 * access scope. Asked here, so a body called from another operation's
 * override is still checked (0036); after the family's guard, it reads the
 * kept answer. Create has no row to filter: its body asks with its data.
 */
async function scopeOf(
  ctx: FamilyContext<unknown>,
  collection: AnyCollection,
  action: Action,
): Promise<AnyWhere | undefined> {
  if (action === 'create') return undefined;
  return (await ctx.access.scope(collection, action)).where;
}

/** `tenantId` for an event payload, on a tenanted collection only. */
function tenantPayload(call: Call): { tenantId?: string } {
  return call.tenantId === undefined ? {} : { tenantId: call.tenantId };
}

function notFound(call: Call, id: string) {
  return LatticeError.NOT_FOUND({ collection: call.collection.slug, id });
}

/** A stored doc as the collection's document type: it has its timestamps. */
function documentOf(
  call: Pick<Call, 'collection'>,
  doc: StoredDoc,
): Document<AnyShape> {
  const { createdAt, updatedAt } = doc;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    throw new Error(
      `Lattice: "${call.collection.slug}.${doc.id}" has no createdAt or updatedAt`,
    );
  }
  return { ...doc, createdAt, updatedAt };
}

/** A document's own tenant, for a tenanted collection. */
function tenantOfDoc(
  collection: AnyCollection,
  doc: StoredDoc,
): string | undefined {
  const value =
    collection.tenant === undefined ? undefined : doc[collection.tenant];
  return typeof value === 'string' ? value : undefined;
}

/** A document of a collection, in a delete's plan. */
type Node = { readonly collection: AnyCollection; readonly doc: StoredDoc };

/** What a delete will do, decided before it writes anything. */
type Plan = {
  /** Cascaded documents, in the order found: parents before children. */
  readonly deletes: Node[];
  /** Documents whose ref to a deleted one is cleared. */
  readonly nullifies: (Node & {
    readonly ref: RefField;
    readonly id: string;
  })[];
};

function keyOf(node: Node): string {
  return JSON.stringify([node.collection.slug, node.doc.id]);
}

/** Every document of `collection` matching `where`, page by page. */
async function* every(
  store: CollectionStore,
  collection: AnyCollection,
  where: AnyWhere,
): AsyncGenerator<StoredDoc> {
  let after: string | undefined;
  do {
    const page = await store.find(
      findQuery(collection, { where, sort: ['id'], limit: 100, after }),
    );
    yield* page.docs;
    after = page.next ?? undefined;
  } while (after !== undefined);
}

/**
 * The onDelete plan of deleting `root`, through every ref to it, and to
 * each cascaded document in turn. Restrict throws REFERENCED here, before
 * anything is written. These are system steps: they skip access functions,
 * but each carries the tenant of the document it starts from, so a row of
 * another tenant that stores this id is neither counted nor touched. A
 * global document's children are found across tenants.
 */
async function planDelete(
  store: CollectionStore,
  referrers: Referrers,
  root: Node,
): Promise<Plan> {
  const plan: Plan = { deletes: [], nullifies: [] };
  const visited = new Set([keyOf(root)]);
  const queue: Node[] = [root];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    const { id } = node.doc;
    const tenantId = tenantOfDoc(node.collection, node.doc);
    for (const { collection, ref, relation } of referrers.get(
      node.collection.slug,
    ) ?? []) {
      const where =
        both(
          { [ref.field]: ref.array ? { has: id } : { eq: id } },
          tenantClause(collection, tenantId),
        ) ?? {};
      if (ref.onDelete === 'restrict') {
        if ((await store.count(collection.slug, where)) > 0) {
          throw LatticeError.REFERENCED({
            collection: node.collection.slug,
            id,
            by: {
              collection: collection.slug,
              field: ref.field,
              ...(relation === undefined ? {} : { relation }),
            },
          });
        }
        continue;
      }
      for await (const doc of every(store, collection, where)) {
        const child = { collection, doc };
        if (ref.onDelete === 'nullify') {
          plan.nullifies.push({ ...child, ref, id });
        } else if (!visited.has(keyOf(child))) {
          // A cycle meets a document already planned: stop there.
          visited.add(keyOf(child));
          plan.deletes.push(child);
          queue.push(child);
        }
      }
    }
  }
  return plan;
}

/**
 * Applies a plan in `store`, returning the events it owes. Clears refs
 * first, then deletes the cascaded documents, the deepest first, so a
 * store without transactions ends with the parent, deleted last by the
 * caller.
 */
async function applyPlan(
  store: CollectionStore,
  call: Pick<Call, 'actorId'>,
  plan: Plan,
): Promise<object[]> {
  const events: object[] = [];
  const deleted = new Set(plan.deletes.map(keyOf));
  for (const { collection, doc, ref, id } of plan.nullifies) {
    if (deleted.has(keyOf({ collection, doc }))) continue;
    // Read again: an earlier step may have changed this document.
    const current = await store.get(collection.slug, doc.id);
    if (current === null) continue;
    const value = current[ref.field];
    const cleared = ref.array
      ? Array.isArray(value)
        ? value.filter((element) => element !== id)
        : value
      : ref.cleared;
    const updated = await store.update(
      collection.slug,
      doc.id,
      touched({ [ref.field]: cleared }),
    );
    if (updated === null) continue;
    const tenantId = tenantOfDoc(collection, updated);
    events.push(
      new collection.events.updated({
        doc: documentOf({ collection }, updated),
        previous: documentOf({ collection }, current),
        actorId: call.actorId,
        ...(tenantId === undefined ? {} : { tenantId }),
      } satisfies Payload<'updated'>),
    );
  }
  for (const { collection, doc } of [...plan.deletes].reverse()) {
    const removed = await store.remove(collection.slug, doc.id);
    if (removed === null) continue;
    const tenantId = tenantOfDoc(collection, removed);
    events.push(
      new collection.events.deleted({
        doc: documentOf({ collection }, removed),
        actorId: call.actorId,
        ...(tenantId === undefined ? {} : { tenantId }),
      } satisfies Payload<'deleted'>),
    );
  }
  return events;
}

async function read(
  call: Pick<Call, 'collection'>,
  doc: StoredDoc,
): Promise<Document<AnyShape>> {
  const document = documentOf(call, doc);
  const { afterRead } = call.collection;
  return afterRead === undefined ? document : afterRead({ doc: document });
}

/** What populating a read works with. */
type Populating = Pick<Call, 'store' | 'access' | 'collections'>;

/** The ids a ref field holds: one, a list, or none. */
function idsIn(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (id): id is string => typeof id === 'string',
  );
}

/**
 * The documents of `slug` among `ids` that the caller may read, by id: one
 * getMany under the caller's read scope there, which carries the tenant,
 * then each through its afterRead. A `false` read access withholds them
 * all rather than failing the read that populates them.
 */
async function readable(
  call: Populating,
  slug: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Document<AnyShape>>> {
  const collection = call.collections.get(slug);
  if (collection === undefined) {
    throw new Error(`Lattice: no collection "${slug}" to populate`);
  }
  const scope = await call.access.scope(collection, 'read').catch((error) => {
    if (LatticeError.is(error) && error.code === 'FORBIDDEN') return null;
    throw error;
  });
  if (scope === null) return new Map();
  const stored = await call.store.getMany(slug, ids, scope.where);
  return new Map(
    await Promise.all(
      stored.map(
        async (doc): Promise<[string, Document<AnyShape>]> => [
          doc.id,
          await read({ collection }, doc),
        ],
      ),
    ),
  );
}

/**
 * `docs` of `collection` with the ref fields in `keys` populated (0022).
 * Ids are collected per target collection across all of `docs`, and each
 * target is read once. A target the caller may not read, or one that no
 * longer exists, is `{ id }`. A list of ids populates element-wise.
 */
async function populated(
  call: Populating,
  collection: AnyCollection,
  keys: readonly string[],
  docs: readonly Document<AnyShape>[],
): Promise<Document<AnyShape>[]> {
  const refs = collection.refs.filter((ref) => keys.includes(ref.field));
  if (refs.length === 0) return [...docs];
  const wanted = new Map<string, Set<string>>();
  for (const doc of docs) {
    for (const ref of refs) {
      const ids = wanted.get(ref.slug) ?? new Set();
      for (const id of idsIn(doc[ref.field])) ids.add(id);
      wanted.set(ref.slug, ids);
    }
  }
  const found = new Map(
    await Promise.all(
      [...wanted].map(
        async ([slug, ids]): Promise<
          [string, ReadonlyMap<string, Document<AnyShape>>]
        > => [slug, await readable(call, slug, [...ids])],
      ),
    ),
  );
  return docs.map((doc) => {
    const next = { ...doc };
    for (const ref of refs) {
      const targets = found.get(ref.slug);
      const swap = (id: unknown) =>
        typeof id === 'string' ? (targets?.get(id) ?? { id }) : id;
      const value = doc[ref.field];
      next[ref.field] = Array.isArray(value) ? value.map(swap) : swap(value);
    }
    return next;
  });
}

async function change(
  call: Call,
  args: ChangeArgs<AnyShape>,
): Promise<Data<AnyShape>> {
  const { beforeChange } = call.collection;
  return beforeChange === undefined ? args.data : beforeChange(args);
}

/**
 * Each operation's body. Each parses its own input: the family guard has
 * rejected bad input, but hexok hands execute the raw value, so parsing here
 * strips unknown keys and applies the create schema's defaults.
 */
/*
 * Each write publishes its event after the store write succeeds, so a failed
 * write publishes nothing. A publish that fails reaches the caller although
 * the write stays: the delivery gap architecture.md accepts until the outbox.
 */
/**
 * `document` with the `many()` relations in `keys` populated, as `get`
 * does: each relation's links in one find on its join collection, inside
 * the parent's tenant, then their targets in one getMany. `set` keeps a
 * parent to at most 1000 links, so one find holds them all. The links run
 * under the parent's read, as `list` does, which the get has passed.
 */
async function withLinks(
  call: Populating,
  collection: AnyCollection,
  keys: readonly string[],
  parent: StoredDoc,
  document: Document<AnyShape>,
): Promise<Document<AnyShape>> {
  const next = { ...document };
  for (const [name, relation] of Object.entries(collection.relations)) {
    if (!keys.includes(name)) continue;
    const join = relation.through;
    const where = both(
      { [relation.parentField]: { eq: parent.id } },
      tenantClause(join, tenantOfDoc(collection, parent)),
    );
    const { docs } = await call.store.find(
      findQuery(join, { where, limit: maxLinks }),
    );
    const targets = await readable(
      call,
      relation.target,
      docs.flatMap((link) => idsIn(link[relation.targetField])),
    );
    const fields = linkFields(relation);
    next[name] = docs.map((link) => {
      const id = link[relation.targetField];
      return {
        ...Object.fromEntries(
          fields
            .filter((field) => link[field] !== undefined)
            .map((field) => [field, link[field]]),
        ),
        doc: typeof id === 'string' ? (targets.get(id) ?? { id }) : id,
      };
    });
  }
  return next;
}

const operations: Record<
  Action,
  (call: Call, raw: unknown) => Promise<unknown>
> = {
  async find(call, raw) {
    const { where, sort, limit, after } = parse(call.ops.find.input, raw);
    await refuseWithheld(call.access, call.collection, 'find', raw);
    const { populate = [] } = parse(call.populate, raw);
    const page = await call.store.find(
      findQuery(call.collection, {
        where: both(where, call.scope),
        sort,
        limit,
        after,
      }),
    );
    const docs = await Promise.all(page.docs.map((doc) => read(call, doc)));
    return {
      docs: await populated(call, call.collection, populate, docs),
      next: page.next,
    };
  },

  async count(call, raw) {
    const { where } = parse(call.ops.count.input, raw);
    await refuseWithheld(call.access, call.collection, 'count', raw);
    return {
      count: await call.store.count(
        call.collection.slug,
        both(where, call.scope),
      ),
    };
  },

  async countBy(call, raw) {
    const { field, where, limit } = parse(call.ops.countBy.input, raw);
    await refuseWithheld(call.access, call.collection, 'countBy', raw);
    // A caller inside a tenant sees one tenant: its count by the tenant
    // field is its total, which is not what it asked for (0046).
    if (field === call.collection.tenant && call.tenantId !== undefined) {
      throw LatticeError.VALIDATION({
        issues: [
          {
            path: ['field'],
            message: `"${field}" is the tenant field: only a call that bypasses tenancy counts by it`,
          },
        ],
      });
    }
    const scoped = both(where, call.scope);
    return call.store.countBy({
      collection: call.collection.slug,
      field,
      limit,
      ...(scoped === undefined ? {} : { where: scoped }),
    });
  },

  async get(call, raw) {
    const { id } = parse(call.ops.get.input, raw);
    const { populate = [] } = parse(call.populate, raw);
    const doc = await call.store.get(call.collection.slug, id, call.scope);
    if (doc === null) throw notFound(call, id);
    const [document] = await populated(call, call.collection, populate, [
      await read(call, doc),
    ]);
    return document === undefined
      ? document
      : withLinks(call, call.collection, populate, doc, document);
  },

  async create(call, raw) {
    const input = parse(call.ops.create.input, raw);
    // Create has no scope to filter by, so its access is asked here, with
    // the data it will write.
    await call.access.scope(call.collection, 'create', input);
    const data = await change(call, { data: input, operation: 'create' });
    // Stamped after beforeChange, so a hook cannot pick the tenant.
    const { tenant } = call.collection;
    const doc = stamped(
      tenant === undefined
        ? data
        : { ...withoutTenant(call.collection, data), [tenant]: call.tenantId },
    );
    await call.store.insert(call.collection.slug, doc);
    await call.events.publish(
      new call.collection.events.created({
        doc,
        actorId: call.actorId,
        ...tenantPayload(call),
      } satisfies Payload<'created'>),
    );
    return read(call, doc);
  },

  async update(call, raw) {
    // The id schema types `id`; across all collections the patch schema is an
    // index signature, which would type it unknown.
    const { id } = parse(call.ops.get.input, raw);
    const { id: _, ...patch } = parse(call.ops.update.input, raw);
    await refuseWithheld(call.access, call.collection, 'update', patch);
    const stored = await call.store.get(call.collection.slug, id, call.scope);
    if (stored === null) throw notFound(call, id);
    const previous = documentOf(call, stored);
    // The tenant field is Lattice's, like the system fields: the schema does
    // not have it, so leaving it in would read as a stored key to remove.
    const { id: _id, createdAt, updatedAt, ...stamps } = previous;
    const data = withoutTenant(call.collection, stamps);
    // The merged document must pass the whole schema, as a create would, so
    // an object-level refinement holds on update too. Parsing also drops
    // stored keys the schema no longer has.
    // A null on a field it clears removes the key (0035); a nullable field
    // keeps its null as a value.
    const { cleared } = call.ops.update;
    const merged = parse(
      call.ops.create.input,
      Object.fromEntries(
        Object.entries({ ...data, ...patch }).filter(
          ([key, value]) => value !== null || !cleared.has(key),
        ),
      ),
    );
    // beforeChange sees the whole document after the change, as on create.
    // A hook that returns the tenant field changes nothing: update never
    // writes it.
    const next = withoutTenant(
      call.collection,
      await change(call, { data: merged, operation: 'update', previous }),
    );
    // Only the fields that differ from the stored ones are written. A stored
    // key that is gone from `next` (dropped by the schema or by the hook) is
    // written as undefined, which the store removes.
    const changes = Object.fromEntries(
      Object.keys({ ...data, ...next })
        .filter((key) => !isDeepStrictEqual(data[key], next[key]))
        .map((key) => [key, next[key]]),
    );
    const updated = await call.store.update(
      call.collection.slug,
      id,
      touched(changes),
      call.scope,
    );
    if (updated === null) throw notFound(call, id);
    await call.events.publish(
      new call.collection.events.updated({
        doc: documentOf(call, updated),
        previous,
        actorId: call.actorId,
        ...tenantPayload(call),
      } satisfies Payload<'updated'>),
    );
    return read(call, updated);
  },

  async delete(call, raw) {
    const { id } = parse(call.ops.delete.input, raw);
    const { slug } = call.collection;
    // With refs to this collection, onDelete runs in one store transaction,
    // and its events publish only after the commit (0028).
    const { removed, owed } =
      (call.referrers.get(slug) ?? []).length === 0
        ? { removed: await call.store.remove(slug, id, call.scope), owed: [] }
        : await call.store.transaction(async (store) => {
            const doc = await store.get(slug, id, call.scope);
            if (doc === null) throw notFound(call, id);
            const plan = await planDelete(store, call.referrers, {
              collection: call.collection,
              doc,
            });
            const owed = await applyPlan(store, call, plan);
            return { removed: await store.remove(slug, id, call.scope), owed };
          });
    if (removed === null) throw notFound(call, id);
    for (const event of owed) await call.events.publish(event);
    await call.events.publish(
      new call.collection.events.deleted({
        doc: documentOf(call, removed),
        actorId: call.actorId,
        ...tenantPayload(call),
      } satisfies Payload<'deleted'>),
    );
    return read(call, removed);
  },
};

/**
 * What one generated operation does, from parsing its input to its events:
 * the body its use case runs, and what an override's `generated` calls
 * (0036). It runs no guards, logging or spans; the calling use case has.
 */
export type Body<Ctx> = (ctx: Ctx, input: unknown) => Promise<unknown>;

/** The body of one generated operation. */
export function operationBody<Actor>(
  family: Family<Actor>,
  store: CollectionStore,
  events: EventPublisher,
  collection: AnyCollection,
  ops: Operations<AnyShape>,
  action: Action,
  populate: PopulateInput,
  referrers: Referrers,
  collections: ReadonlyMap<string, AnyCollection>,
): Body<FamilyContext<Actor>> {
  const run = operations[action];
  return async (ctx, raw) =>
    run(
      {
        store,
        events,
        collection,
        ops,
        scope: await scopeOf(ctx, collection, action),
        populate,
        actorId: family.actorId(ctx.actor),
        tenantId: CallAccess.stampOf(ctx.access, collection),
        referrers,
        access: ctx.access,
        collections,
      },
      raw,
    );
}

/**
 * A generated use case, an operation's or a relation operation's, in the
 * app's family: its guards, logging and span around `body`.
 */
export function generatedUseCase<Actor>(
  family: Family<Actor>,
  token: string,
  spec: {
    readonly collection: AnyCollection;
    readonly input: z.core.$ZodType;
    readonly output: z.core.$ZodType;
  },
  body: Body<FamilyContext<Actor>>,
): Executable<FamilyContext<Actor>> {
  class Generated extends family(token, spec) {
    async execute(ctx: FamilyContext<Actor>, raw: unknown): Promise<unknown> {
      return body(ctx, raw);
    }
  }
  return new Generated();
}

/**
 * The body of a relation operation of `collection`: `<slug>.<name>.list` or
 * `.set`. `list` runs the parent's read and `set` its update (0028): each
 * first gets the parent under that scope, so a parent outside it is
 * NOT_FOUND.
 */
export function relationBody<Actor>(
  family: Family<Actor>,
  store: CollectionStore,
  events: EventPublisher,
  collection: AnyCollection,
  name: string,
  relation: AnyRelation,
  op: 'list' | 'set',
  collections: ReadonlyMap<string, AnyCollection>,
): Body<FamilyContext<Actor>> {
  const join = relation.through;
  const { parentField, targetField } = relation;
  // The fields of a link, as `set` compares them.
  const linkFields = Object.keys(join.schema.shape).filter(
    (field) => field !== parentField,
  );

  /** The parent under the scope of `action`, or NOT_FOUND. */
  async function parentOf(ctx: FamilyContext<Actor>, id: string) {
    const scope = await ctx.access.scope(collection, `${name}.${op}`);
    const parent = await store.get(collection.slug, id, scope.where);
    if (parent === null) {
      throw LatticeError.NOT_FOUND({ collection: collection.slug, id });
    }
    return parent;
  }

  /** The links of `id`, inside the parent's tenant. */
  function linksOf(id: string, tenantId: string | undefined): AnyWhere {
    return (
      both({ [parentField]: { eq: id } }, tenantClause(join, tenantId)) ?? {}
    );
  }

  async function list(ctx: FamilyContext<Actor>, raw: unknown) {
    const { id, where, sort, limit, after, populate } = parse(
      relation.list.input,
      raw,
    );
    const parent = await parentOf(ctx, id);
    const page = await store.find(
      findQuery(join, {
        where: both(where, linksOf(id, tenantOfDoc(collection, parent))),
        sort,
        limit,
        after,
      }),
    );
    return {
      docs: await populated(
        { store, access: ctx.access, collections },
        join,
        populate ?? [],
        page.docs.map((doc) => documentOf({ collection: join }, doc)),
      ),
      next: page.next,
    };
  }

  async function set(ctx: FamilyContext<Actor>, raw: unknown) {
    const { id, links } = parse(relation.set.input, raw);
    const parent = await parentOf(ctx, id);
    const tenantId = tenantOfDoc(collection, parent);
    const actorId = family.actorId(ctx.actor);
    const tenant = tenantId === undefined ? {} : { tenantId };
    // The set replaces the links by diffing: an unchanged link keeps its id
    // and createdAt, and each change owes its own event, after the commit.
    const { docs, owed } = await store.transaction(async (tx) => {
      const existing: StoredDoc[] = [];
      for await (const doc of every(tx, join, linksOf(id, tenantId))) {
        existing.push(doc);
      }
      const byTarget = new Map(existing.map((doc) => [doc[targetField], doc]));
      const wanted = new Set(links.map((link) => link[targetField]));
      const owed: object[] = [];
      for (const doc of existing) {
        if (wanted.has(doc[targetField])) continue;
        const removed = await tx.remove(join.slug, doc.id);
        if (removed === null) continue;
        owed.push(
          new join.events.deleted({
            doc: documentOf({ collection: join }, removed),
            actorId,
            ...tenant,
          } satisfies Payload<'deleted'>),
        );
      }
      const docs: StoredDoc[] = [];
      for (const link of links) {
        const previous = byTarget.get(link[targetField]);
        if (previous === undefined) {
          const doc = stamped({
            ...link,
            [parentField]: id,
            ...(join.tenant === undefined || tenantId === undefined
              ? {}
              : { [join.tenant]: tenantId }),
          });
          await tx.insert(join.slug, doc);
          owed.push(
            new join.events.created({
              doc: documentOf({ collection: join }, doc),
              actorId,
              ...tenant,
            } satisfies Payload<'created'>),
          );
          docs.push(doc);
          continue;
        }
        // A field the new link leaves out is written as undefined, which
        // the store removes.
        const changes = Object.fromEntries(
          linkFields
            .filter((field) => !isDeepStrictEqual(previous[field], link[field]))
            .map((field) => [field, link[field]]),
        );
        if (Object.keys(changes).length === 0) {
          docs.push(previous);
          continue;
        }
        const updated = await tx.update(
          join.slug,
          previous.id,
          touched(changes),
        );
        if (updated === null) throw notFoundIn(join, previous.id);
        owed.push(
          new join.events.updated({
            doc: documentOf({ collection: join }, updated),
            previous: documentOf({ collection: join }, previous),
            actorId,
            ...tenant,
          } satisfies Payload<'updated'>),
        );
        docs.push(updated);
      }
      return { docs, owed };
    });
    for (const event of owed) await events.publish(event);
    return { docs: docs.map((doc) => documentOf({ collection: join }, doc)) };
  }

  return op === 'list' ? list : set;
}

function notFoundIn(collection: AnyCollection, id: string) {
  return LatticeError.NOT_FOUND({ collection: collection.slug, id });
}
