import { type DocsMeta, docs } from '@ts-pf/docs';
import { type McpEffect, mcp } from '@ts-pf/mcp/meta';

/**
 * Every text and fact Lattice writes into a contract, in one place: each
 * procedure's summary and `lattice` meta, a collection's label, and why a
 * query on a maskable field may be refused. They reach the catalog, so
 * OpenAPI, codegen's JSDoc, MCP tools and the admin read them with no code
 * in the app.
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

/** How a collection reads in a sentence: `{ singular: 'company', plural: 'companies' }`. */
export type Label = { readonly singular: string; readonly plural: string };

/**
 * What every Lattice procedure says about itself in its meta, under the
 * `lattice` key: its collection and that collection's label, and which
 * operation it is. A relation's `list` and `set` name the relation, and a
 * method names itself. An override carries the meta of the operation it
 * replaces, because clients see the same procedure.
 */
export type LatticeMeta =
  | {
      readonly collection: string;
      readonly label: Label;
      readonly operation:
        | 'find'
        | 'count'
        | 'get'
        | 'create'
        | 'update'
        | 'delete';
    }
  | {
      readonly collection: string;
      readonly label: Label;
      readonly operation: 'list' | 'set';
      readonly relation: string;
      /** The slug of the collection the relation's links point to. */
      readonly target: string;
    }
  | {
      readonly collection: string;
      readonly label: Label;
      readonly operation: 'method';
      readonly method: string;
    };

/** A procedure's meta: its summary, its MCP effect, and Lattice's facts. */
export type ProcedureMeta<Fx extends McpEffect> = {
  readonly docs: DocsMeta;
  readonly mcp: { readonly effect: Fx };
  readonly lattice: LatticeMeta;
};

/** The words of an identifier: `post_categories` and `postCategories` are "post categories". */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .join(' ')
    .toLowerCase();
}

/**
 * The singular of an English plural, for the common endings only. A slug
 * it gets wrong, such as `news` or `people`, declares its label.
 */
function singularOf(plural: string): string {
  if (/[^aeiou]ies$/.test(plural)) return `${plural.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zzes)$/.test(plural)) return plural.slice(0, -2);
  if (/(ss|us|is)$/.test(plural) || !plural.endsWith('s')) return plural;
  return plural.slice(0, -1);
}

/** A collection's label from its slug: `deal_stages` is "deal stage" and "deal stages". */
export function labelOf(slug: string): Label {
  const plural = words(slug);
  const last = plural.lastIndexOf(' ');
  return {
    singular: `${plural.slice(0, last + 1)}${singularOf(plural.slice(last + 1))}`,
    plural,
  };
}

/** What a summary names: the collection, the operation, and what it populates. */
export type Described =
  | {
      readonly slug: string;
      readonly label: Label;
      readonly op: Exclude<GeneratedOp, 'list' | 'set'>;
      readonly populate: readonly string[];
    }
  | {
      readonly slug: string;
      readonly label: Label;
      readonly op: 'list' | 'set';
      readonly relation: string;
      readonly target: string;
      readonly populate: readonly string[];
    };

const query =
  'Filter with where, order with sort, and page with limit and after (the previous page’s next).';

/**
 * One short sentence per operation, naming the inputs that matter. "One",
 * not "a" or "an": the article depends on how the label sounds.
 */
function summaryOf(described: Described): string {
  const { singular, plural } = described.label;
  const populate =
    described.populate.length === 0
      ? ''
      : ` populate expands ${described.populate.join(', ')} into documents.`;
  switch (described.op) {
    case 'find':
      return `Find ${plural}. ${query}${populate}`;
    case 'count':
      return `Count ${plural}. Filter with where.`;
    case 'get':
      return `Get one ${singular} by id.${populate}`;
    case 'create':
      return `Create one ${singular}.`;
    case 'update':
      return `Update one ${singular} by id. Send only the fields to change.`;
    case 'delete':
      return `Delete one ${singular} by id.`;
    case 'list':
      return `List the ${words(described.relation)} of one ${singular}, by its id. ${query}${populate}`;
    case 'set':
      return `Replace the ${words(described.relation)} of one ${singular}, by its id. Links not given are removed.`;
  }
}

/** The `lattice` meta of a generated or relation procedure. */
function latticeOf(described: Described): LatticeMeta {
  const { slug, label } = described;
  switch (described.op) {
    case 'list':
    case 'set':
      return {
        collection: slug,
        label,
        operation: described.op,
        relation: described.relation,
        target: described.target,
      };
    default:
      return { collection: slug, label, operation: described.op };
  }
}

/** The meta of a generated procedure. */
export function generatedMeta<Op extends GeneratedOp>(
  described: Described & { readonly op: Op },
): ProcedureMeta<EffectOf<Op>> {
  return {
    ...docs({ summary: summaryOf(described) }),
    ...mcp({ effect: effects[described.op] }),
    lattice: latticeOf(described),
  };
}

/** The meta of a method's procedure, from its `summary` and `effect` statics. */
export function methodMeta<Fx extends McpEffect>(method: {
  readonly slug: string;
  readonly label: Label;
  readonly name: string;
  readonly summary: string;
  readonly effect: Fx;
}): ProcedureMeta<Fx> {
  return {
    ...docs({ summary: method.summary }),
    ...mcp({ effect: method.effect }),
    lattice: {
      collection: method.slug,
      label: method.label,
      operation: 'method',
      method: method.name,
    },
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
