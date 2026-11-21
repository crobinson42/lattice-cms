import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import { CallAccess } from './access.js';
import type {
  Action,
  AnyCollection,
  ChangeArgs,
  Data,
  Document,
  Events,
  Operations,
} from './collection.js';
import { LatticeError, parse } from './errors.js';
import type { Family, FamilyContext } from './family.js';
import { findQuery, stamped, touched } from './repo.js';
import type { CollectionStore, StoredDoc } from './store.js';
import { withoutTenant } from './tenancy.js';
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
  readonly actorId: string;
  /** The call's tenant on this collection: what create stamps and events carry. */
  readonly tenantId: string | undefined;
};

/**
 * The filter that limits what a call may see and change (0005): the call's
 * access scope. The family's access guard has already asked, so this reads
 * its kept answer. Create has no row to filter, and its answer is not kept,
 * so it does not ask again.
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
function documentOf(call: Call, doc: StoredDoc): Document<AnyShape> {
  const { createdAt, updatedAt } = doc;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    throw new Error(
      `Lattice: "${call.collection.slug}.${doc.id}" has no createdAt or updatedAt`,
    );
  }
  return { ...doc, createdAt, updatedAt };
}

async function read(call: Call, doc: StoredDoc): Promise<Document<AnyShape>> {
  const document = documentOf(call, doc);
  const { afterRead } = call.collection;
  return afterRead === undefined ? document : afterRead({ doc: document });
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
const operations: Record<
  Action,
  (call: Call, raw: unknown) => Promise<unknown>
> = {
  async find(call, raw) {
    const { where, sort, limit, after } = parse(call.ops.find.input, raw);
    const page = await call.store.find(
      findQuery(call.collection.slug, {
        where: both(where, call.scope),
        sort,
        limit,
        after,
      }),
    );
    return {
      docs: await Promise.all(page.docs.map((doc) => read(call, doc))),
      next: page.next,
    };
  },

  async count(call, raw) {
    const { where } = parse(call.ops.count.input, raw);
    return {
      count: await call.store.count(
        call.collection.slug,
        both(where, call.scope),
      ),
    };
  },

  async get(call, raw) {
    const { id } = parse(call.ops.get.input, raw);
    const doc = await call.store.get(call.collection.slug, id, call.scope);
    if (doc === null) throw notFound(call, id);
    return read(call, doc);
  },

  async create(call, raw) {
    const input = parse(call.ops.create.input, raw);
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
    const merged = parse(call.ops.create.input, { ...data, ...patch });
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
    const removed = await call.store.remove(
      call.collection.slug,
      id,
      call.scope,
    );
    if (removed === null) throw notFound(call, id);
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

/** The generated use case for one operation, in the app's family. */
export function generated<Actor>(
  family: Family<Actor>,
  store: CollectionStore,
  events: EventPublisher,
  collection: AnyCollection,
  ops: Operations<AnyShape>,
  action: Action,
): Executable<FamilyContext<Actor>> {
  const { input, output } = ops[action];
  const run = operations[action];
  class Generated extends family(`${collection.slug}.${action}`, {
    collection,
    input,
    output,
  }) {
    constructor(
      private readonly deps: {
        store: CollectionStore;
        events: EventPublisher;
      },
    ) {
      super();
    }

    async execute(ctx: FamilyContext<Actor>, raw: unknown): Promise<unknown> {
      return run(
        {
          ...this.deps,
          collection,
          ops,
          scope: await scopeOf(ctx, collection, action),
          actorId: family.actorId(ctx.actor),
          tenantId: CallAccess.stampOf(ctx.access, collection),
        },
        raw,
      );
    }
  }
  return new Generated({ store, events });
}
