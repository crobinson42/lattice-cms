import type { StoredDoc } from '@latticecms/core/store';
import { Mapper } from 'hexok';
import { z } from 'zod';

/** A document as Lattice stores it: `id` and any fields. */
const storedDoc = z.looseObject({ id: z.string() });

/** The same document in MongoDB: `id` kept in `_id`, as a string. */
const mongoDoc = z.looseObject({ _id: z.string() });

/** A Mongo document as the driver reads and writes it. */
export type MongoDocument = z.output<typeof mongoDoc>;

/**
 * Maps a `StoredDoc` to its Mongo document and back. Only `id` moves; every
 * other field keeps its name and value. Each direction builds a new object,
 * so the driver's insert, which adds `_id` to what it is given, never
 * touches the caller's document.
 */
export class MongoDoc extends Mapper('mongo.StoredDoc', storedDoc, mongoDoc) {
  protected fromSource(doc: StoredDoc): MongoDocument {
    const { id, ...fields } = doc;
    return { ...fields, _id: id };
  }

  protected toSource(doc: MongoDocument): StoredDoc {
    const { _id, ...fields } = doc;
    return { ...fields, id: _id };
  }
}
