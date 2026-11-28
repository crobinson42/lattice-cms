/**
 * `@latticecms/core/store`: what a `CollectionStore` adapter needs. A store
 * receives values Lattice has already parsed, so the input schemas stay out.
 * The conformance suite is `@latticecms/core/store/conformance`.
 */

export {
  after,
  cursorValues,
  encodeCursor,
  type Order,
  orderOf,
} from '../sort.js';
export {
  CollectionStore,
  type CountByQuery,
  type FindQuery,
  type Group,
  type Groups,
  type Index,
  type Page,
  type Patch,
  type StoredDoc,
} from '../store.js';
export type { AnyWhere, FieldOps } from '../where.js';
