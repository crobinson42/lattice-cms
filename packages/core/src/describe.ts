import { type DocsMeta, docs } from '@ts-pf/docs';
import { mcp } from '@ts-pf/mcp/meta';

/**
 * Every text Lattice writes into a contract, in one place: each generated
 * procedure's summary, and why a query on a maskable field may be refused.
 * They reach the catalog, so OpenAPI, codegen's JSDoc and MCP tools read
 * them with no code in the app.
 */

/** A generated collection operation, or a relation's. */
type GeneratedOp =
  | 'find'
  | 'count'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'set';

/**
 * How an operation affects data, as `@ts-pf/mcp` reads it for tool
 * annotations: reads are read-only, and an operation that removes data
 * (delete, or a relation's `set`, which drops links it is not given) is
 * destructive.
 */
export type EffectOf<Op extends GeneratedOp> = Op extends
  | 'find'
  | 'count'
  | 'get'
  | 'list'
  ? 'read'
  : Op extends 'delete' | 'set'
    ? 'destructive'
    : 'write';

const effects: { readonly [Op in GeneratedOp]: EffectOf<Op> } = {
  find: 'read',
  count: 'read',
  get: 'read',
  list: 'read',
  create: 'write',
  update: 'write',
  delete: 'destructive',
  set: 'destructive',
};

/** A generated procedure's meta: its summary, and its MCP effect. */
export type GeneratedMeta<Op extends GeneratedOp> = {
  readonly docs: DocsMeta;
  readonly mcp: { readonly effect: EffectOf<Op> };
};

/** What a summary names: the collection, the operation, and what it populates. */
export type Described =
  | {
      readonly slug: string;
      readonly op: Exclude<GeneratedOp, 'list' | 'set'>;
      readonly populate: readonly string[];
    }
  | {
      readonly slug: string;
      readonly op: 'list' | 'set';
      readonly relation: string;
      readonly populate: readonly string[];
    };

const query =
  'Filter with where, order with sort, and page with limit and after (the previous page’s next).';

/** One short sentence per operation, naming the inputs that matter. */
function summaryOf(described: Described): string {
  const { slug } = described;
  const populate =
    described.populate.length === 0
      ? ''
      : ` populate expands ${described.populate.join(', ')} into documents.`;
  switch (described.op) {
    case 'find':
      return `Find ${slug}. ${query}${populate}`;
    case 'count':
      return `Count ${slug}. Filter with where.`;
    case 'get':
      return `Get one ${slug} document by id.${populate}`;
    case 'create':
      return `Create a ${slug} document.`;
    case 'update':
      return `Update a ${slug} document by id. Send only the fields to change.`;
    case 'delete':
      return `Delete a ${slug} document by id.`;
    case 'list':
      return `List the ${described.relation} links of one ${slug} document, by its id. ${query}${populate}`;
    case 'set':
      return `Replace the ${described.relation} links of one ${slug} document, by its id. Links not given are removed.`;
  }
}

/** The meta of a generated procedure. */
export function generatedMeta<Op extends GeneratedOp>(
  described: Described & { readonly op: Op },
): GeneratedMeta<Op> {
  return {
    ...docs({ summary: summaryOf(described) }),
    ...mcp({ effect: effects[described.op] }),
  };
}

/** A `where` entry's description for a maskable field. */
export function refusedWhere(field: string): string {
  return `Refused (VALIDATION) when the caller may not read ${field}.`;
}

/** A `sort` description for a collection with maskable fields. */
export function refusedSort(fields: readonly string[]): string {
  return `Field names, "-" first for descending. Sorting on ${fields.join(', ')} is refused (VALIDATION) when the caller may not read it.`;
}
