import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import type {
  Action,
  AnyCollection,
  ChangeArgs,
  Data,
  Document,
  Operations,
} from './collection.js';
import { LatticeError, parse } from './errors.js';
import type { Family, FamilyContext } from './family.js';
import { defaultLimit, defaultSort } from './sort.js';
import type { CollectionStore, Doc } from './store.js';
import type { AnyWhere } from './where.js';

type AnyShape = z.core.$ZodShape;

/** A use case as build() calls it. */
export type Executable<Ctx> = {
  execute(ctx: Ctx, input: unknown): Promise<unknown>;
};

/** What one generated call works with. */
type Call = {
  readonly store: CollectionStore;
  readonly collection: AnyCollection;
  readonly ops: Operations<AnyShape>;
  /** The access and tenant filter of this call, for every store call. */
  readonly scope: AnyWhere | undefined;
};

/**
 * The filter that limits what a call may see and change. Phase 1's Access
 * port and the tenant clause fill it, here and nowhere else (0005). Until
 * then every call sees every row.
 */
function scopeOf(
  _ctx: unknown,
  _collection: AnyCollection,
): AnyWhere | undefined {
  return undefined;
}

function both(
  a: AnyWhere | undefined,
  b: AnyWhere | undefined,
): AnyWhere | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { and: [a, b] };
}

function notFound(call: Call, id: string) {
  return LatticeError.NOT_FOUND({ collection: call.collection.slug, id });
}

/** A stored doc as the collection's document type: it has its timestamps. */
function documentOf(call: Call, doc: Doc): Document<AnyShape> {
  const { createdAt, updatedAt } = doc;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    throw new Error(
      `Lattice: "${call.collection.slug}.${doc.id}" has no createdAt or updatedAt`,
    );
  }
  return { ...doc, createdAt, updatedAt };
}

async function read(call: Call, doc: Doc): Promise<Document<AnyShape>> {
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
const operations: Record<
  Action,
  (call: Call, raw: unknown) => Promise<unknown>
> = {
  async find(call, raw) {
    const { where, sort, limit, after } = parse(call.ops.find.input, raw);
    const filter = both(where, call.scope);
    const page = await call.store.find({
      collection: call.collection.slug,
      sort: sort ?? defaultSort,
      limit: limit ?? defaultLimit,
      ...(filter === undefined ? {} : { where: filter }),
      ...(after === undefined ? {} : { after }),
    });
    return {
      docs: await Promise.all(page.docs.map((doc) => read(call, doc))),
      next: page.next,
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
    const now = new Date().toISOString();
    const doc = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await call.store.insert(call.collection.slug, doc);
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
    const { id: _id, createdAt, updatedAt, ...data } = previous;
    // The merged document must pass the whole schema, as a create would, so
    // an object-level refinement holds on update too. Parsing also drops
    // stored keys the schema no longer has.
    const merged = parse(call.ops.create.input, { ...data, ...patch });
    // beforeChange sees the whole document after the change, as on create.
    const next = await change(call, {
      data: merged,
      operation: 'update',
      previous,
    });
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
      { ...changes, updatedAt: new Date().toISOString() },
      call.scope,
    );
    if (updated === null) throw notFound(call, id);
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
    return read(call, removed);
  },
};

/** The generated use case for one operation, in the app's family. */
export function generated<Actor>(
  family: Family<Actor>,
  store: CollectionStore,
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
    constructor(private readonly deps: { store: CollectionStore }) {
      super();
    }

    async execute(ctx: FamilyContext<Actor>, raw: unknown): Promise<unknown> {
      const scope = scopeOf(ctx, collection);
      return run({ store: this.deps.store, collection, ops, scope }, raw);
    }
  }
  return new Generated({ store });
}
