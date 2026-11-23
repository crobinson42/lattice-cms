import type { LatticeMeta } from '@latticecms/core';
import type { JsonSchema } from '@ts-pf/docs';
import type { Catalog, Procedure } from './catalog.js';
import { type Field, fieldsOf, propertiesOf, resolve } from './schema.js';

/** A generated operation: find, count, get, create, update or delete. */
type Operation = Exclude<LatticeMeta['operation'], 'list' | 'set' | 'method'>;

/** A `many()` relation, and the collection its links point to. */
export type Relation = {
  readonly name: string;
  readonly target: string;
};

/** One collection, from the procedures whose `lattice` meta names it. */
export type Collection = {
  readonly slug: string;
  readonly label: LatticeMeta['label'];
  readonly operations: Partial<Record<Operation, Procedure>>;
  readonly relations: readonly Relation[];
  /** Its documents' fields, in schema order. Relations are not fields. */
  readonly fields: readonly Field[];
};

/** The document schema of a `find` output: the items of its `docs`. */
function documentOf(find: Procedure | undefined): JsonSchema {
  const output = find?.output;
  if (output === undefined) return {};
  const docs = propertiesOf(output).find(([name]) => name === 'docs');
  return docs === undefined ? {} : resolve(docs[1].items, output);
}

/**
 * The catalog's collections, in the order their procedures appear. Each
 * procedure joins the collection its meta names; nothing is read from paths.
 */
export function collectionsOf(catalog: Catalog): Collection[] {
  const grouped = new Map<string, Procedure[]>();
  for (const procedure of catalog.procedures) {
    const { collection } = procedure.lattice;
    grouped.set(collection, [...(grouped.get(collection) ?? []), procedure]);
  }
  return [...grouped.entries()].flatMap(([slug, procedures]) => {
    const [first] = procedures;
    if (first === undefined) return [];
    const operations: Partial<Record<Operation, Procedure>> = {};
    const relations: Relation[] = [];
    for (const procedure of procedures) {
      const meta = procedure.lattice;
      if (meta.operation === 'list') {
        relations.push({ name: meta.relation, target: meta.target });
      } else if (meta.operation !== 'set' && meta.operation !== 'method') {
        operations[meta.operation] = procedure;
      }
    }
    const fields = fieldsOf(documentOf(operations.find)).filter(
      (field) => !relations.some(({ name }) => name === field.name),
    );
    return [
      { slug, label: first.lattice.label, operations, relations, fields },
    ];
  });
}

/**
 * The field a document is named by, such as in a link to it: the first
 * required string among `name`, `title`, `label` and `email`, never a
 * maskable one.
 */
export function titleFieldOf(collection: Collection): Field | undefined {
  for (const name of ['name', 'title', 'label', 'email']) {
    const field = collection.fields.find(
      (candidate) => candidate.name === name,
    );
    if (field?.required && field.kind === 'string' && !field.maskable) {
      return field;
    }
  }
  return undefined;
}

const scalars = new Set([
  'string',
  'number',
  'boolean',
  'enum',
  'datetime',
  'ref',
]);

/** The most columns a list shows before `updatedAt`. */
const maxColumns = 6;

/**
 * A list's columns: the title field, then the required scalar fields in
 * schema order, up to six in all, then `updatedAt`. A maskable field counts
 * as required, since only its client schema makes it optional, unless no
 * loaded document carries it: a field rule is per caller, not per document
 * (0031), so the caller may not read it, and the column is left out.
 */
export function columnsOf(
  collection: Collection,
  docs: readonly Record<string, unknown>[],
): Field[] {
  const title = titleFieldOf(collection);
  const rest = collection.fields.filter(
    (field) =>
      field !== title &&
      !field.system &&
      scalars.has(field.kind) &&
      (field.maskable
        ? docs.some((doc) => doc[field.name] !== undefined)
        : field.required),
  );
  const updatedAt = collection.fields.find(
    (field) => field.name === 'updatedAt',
  );
  return [...(title === undefined ? [] : [title]), ...rest]
    .slice(0, maxColumns)
    .concat(updatedAt === undefined ? [] : [updatedAt]);
}
