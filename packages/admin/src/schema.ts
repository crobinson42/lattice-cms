import type { JsonSchema } from '@ts-pf/docs';
import { isRecord } from './catalog.js';

/** How a field's value is shown and filtered, from its JSON Schema type. */
export type Kind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'datetime'
  | 'ref'
  | 'list'
  | 'other';

/** A document field, as the admin derives it from a collection's schemas. */
export type Field = {
  readonly name: string;
  /** The schema's `title`, when the app gave one through Zod meta. */
  readonly title: string | undefined;
  readonly kind: Kind;
  readonly required: boolean;
  /** The values of an enum field. */
  readonly values: readonly string[];
  /** The collection a ref field refers to. */
  readonly ref: string | undefined;
  /** A field the server withholds from a caller who may not read it. */
  readonly maskable: boolean;
  /** `id`, `createdAt`, `updatedAt`, or the tenant field: never input. */
  readonly system: boolean;
};

/** The fields every Lattice document has, which no input sets. */
export const systemFields = ['id', 'createdAt', 'updatedAt'];

/** The schema `#/$defs/<name>` names inside `root`, or `schema` itself. */
export function resolve(schema: unknown, root: JsonSchema): JsonSchema {
  if (!isRecord(schema)) return {};
  const ref = schema.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) return schema;
  const defs = root.$defs;
  const target = isRecord(defs)
    ? defs[ref.slice('#/$defs/'.length)]
    : undefined;
  return isRecord(target) ? target : {};
}

/** The `properties` of an object schema, in schema order. */
export function propertiesOf(schema: JsonSchema): [string, JsonSchema][] {
  const { properties } = schema;
  if (!isRecord(properties)) return [];
  return Object.entries(properties).flatMap(([name, value]) =>
    isRecord(value) ? [[name, value]] : [],
  );
}

function requiredOf(schema: JsonSchema): readonly unknown[] {
  return Array.isArray(schema.required) ? schema.required : [];
}

/** The JSON Schema type names a schema allows, without null. */
export function typesOf(schema: JsonSchema): string[] {
  const { type } = schema;
  const types = Array.isArray(type) ? type : [type];
  return types.filter(
    (name): name is string => typeof name === 'string' && name !== 'null',
  );
}

/** The schema's `anyOf` branches but null, or the schema itself. */
function branchesOf(schema: JsonSchema): JsonSchema[] {
  const { anyOf } = schema;
  if (!Array.isArray(anyOf)) return [schema];
  return anyOf.filter(isRecord).filter((branch) => branch.type !== 'null');
}

/** The plain form of a schema: a populated ref's id branch, or its non-null branch. */
export function plainOf(schema: JsonSchema): JsonSchema {
  const ref = branchesOf(schema).find(
    (branch) => typeof branch['x-lattice-ref'] === 'string',
  );
  return ref ?? branchesOf(schema)[0] ?? schema;
}

function enumOf(schema: JsonSchema): string[] {
  const values = schema.enum;
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

function kindOf(schema: JsonSchema): Kind {
  if (typeof schema['x-lattice-ref'] === 'string') return 'ref';
  if (enumOf(schema).length > 0) return 'enum';
  const [type] = typesOf(schema);
  if (type === 'string') {
    return schema.format === 'date-time' ? 'datetime' : 'string';
  }
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'list';
  return 'other';
}

/**
 * The fields of a collection's documents, in schema order, from the
 * document schema of its `find` output.
 */
export function fieldsOf(document: JsonSchema): Field[] {
  const required = requiredOf(document);
  return propertiesOf(document).map(([name, property]) => {
    const plain = plainOf(property);
    // A list of ids names its target on each item.
    const ref = isRecord(plain.items)
      ? plainOf(plain.items)['x-lattice-ref']
      : plain['x-lattice-ref'];
    const title = property.title ?? plain.title;
    return {
      name,
      title: typeof title === 'string' ? title : undefined,
      kind: kindOf(plain),
      required: required.includes(name),
      values: enumOf(plain),
      ref: typeof ref === 'string' ? ref : undefined,
      maskable: plain['x-lattice-maskable'] === true,
      system: systemFields.includes(name) || plain['x-lattice-tenant'] === true,
    };
  });
}

/** The keys `find` can sort by, ascending and descending, from its input. */
export function sortKeysOf(findInput: JsonSchema | undefined): Set<string> {
  if (findInput === undefined) return new Set();
  const sort = propertiesOf(findInput).find(([name]) => name === 'sort');
  const items = sort === undefined ? undefined : sort[1].items;
  return new Set(isRecord(items) ? enumOf(items) : []);
}

/** Each field's filter operators and their schemas, from `find`'s where. */
export function operatorsOf(
  findInput: JsonSchema | undefined,
): Map<string, [string, JsonSchema][]> {
  if (findInput === undefined) return new Map();
  const where = propertiesOf(findInput).find(([name]) => name === 'where');
  if (where === undefined) return new Map();
  const schema = resolve(where[1], findInput);
  return new Map(
    propertiesOf(schema)
      .filter(([name]) => name !== 'and' && name !== 'or')
      .map(([name, field]) => [name, propertiesOf(resolve(field, findInput))]),
  );
}
