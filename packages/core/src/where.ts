import { z } from 'zod';
import { invalid } from './errors.js';

export type Kind = 'string' | 'number' | 'boolean' | 'enum' | 'other';

const equality = ['string', 'number', 'boolean', 'enum'] as const;
const ordered = ['string', 'number'] as const;

/** The field kinds each operator applies to. `Where` and the validator both read it. */
const operators = {
  eq: equality,
  ne: equality,
  in: equality,
  nin: equality,
  gt: ordered,
  gte: ordered,
  lt: ordered,
  lte: ordered,
  contains: ['string'],
  exists: ['string', 'number', 'boolean', 'enum', 'other'],
} as const satisfies Record<string, readonly Kind[]>;

type Operator = keyof typeof operators;

/** A brand is type-only: a branded string is a string at runtime. */
type Unbrand<T> =
  T extends z.core.$brand<infer Brand>
    ? T extends infer U & z.core.$brand<Brand>
      ? U
      : T
    : T;

/**
 * A field's kind, from its value type. `kindOf` below makes the same
 * decision from the schema: all strings, with an open `string` among them,
 * is 'string'; only string or only number literals is 'enum'; and so on.
 * The table test in where.test.ts checks both sides on every field form.
 */
export type KindOf<V> = [Unbrand<Exclude<V, null | undefined>>] extends [
  infer B,
]
  ? [B] extends [never]
    ? 'other'
    : [B] extends [boolean]
      ? 'boolean'
      : [B] extends [string]
        ? string extends B
          ? 'string'
          : 'enum'
        : [B] extends [number]
          ? number extends B
            ? 'number'
            : 'enum'
          : 'other'
  : never;

type Operand<Op extends Operator, B> = Op extends 'eq' | 'ne'
  ? B | null
  : Op extends 'in' | 'nin'
    ? readonly (B | null)[]
    : Op extends 'contains'
      ? string
      : Op extends 'exists'
        ? boolean
        : B;

/** The operators one field allows, typed from its value. */
export type FieldWhere<V> = {
  readonly [Op in Operator as KindOf<V> extends (typeof operators)[Op][number]
    ? Op
    : never]?: Operand<Op, Exclude<V, null | undefined>>;
};

/**
 * A filter on a collection's documents. Several fields, or several operators
 * on one field, all have to match. `and` and `or` take one or more filters.
 */
export type Where<Doc> = {
  readonly [K in keyof Doc]?: FieldWhere<Doc[K]>;
} & {
  readonly and?: readonly Where<Doc>[];
  readonly or?: readonly Where<Doc>[];
};

/**
 * A wrapper that keeps its inner schema's values (optional, nullable,
 * default, prefault, nonoptional, readonly, catch): its inner schema, and the
 * same wrapper around another one. Undefined for any other schema.
 */
export function wrapperOf(schema: z.core.$ZodType):
  | {
      readonly inner: z.core.$ZodType;
      readonly around: (inner: z.core.$ZodType) => z.core.$ZodType;
    }
  | undefined {
  if (
    schema instanceof z.core.$ZodOptional ||
    schema instanceof z.core.$ZodNullable ||
    schema instanceof z.core.$ZodDefault ||
    schema instanceof z.core.$ZodPrefault ||
    schema instanceof z.core.$ZodNonOptional ||
    schema instanceof z.core.$ZodReadonly ||
    schema instanceof z.core.$ZodCatch
  ) {
    const { def } = schema._zod;
    return {
      inner: def.innerType,
      around: (inner) =>
        z.core.util.clone(schema, { ...def, innerType: inner }),
    };
  }
  return undefined;
}

/** The schema a wrapper keeps the values of, or undefined for any other schema. */
export function innerOf(schema: z.core.$ZodType): z.core.$ZodType | undefined {
  return wrapperOf(schema)?.inner;
}

function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
  const inner = innerOf(schema);
  return inner === undefined ? schema : unwrap(inner);
}

type Atom =
  | 'string'
  | 'stringLiteral'
  | 'number'
  | 'numberLiteral'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'other';

function valueAtoms(value: unknown): Atom[] {
  switch (typeof value) {
    case 'string':
      return ['stringLiteral'];
    case 'number':
      return ['numberLiteral'];
    case 'boolean':
      return ['boolean'];
    case 'undefined':
      return ['undefined'];
    default:
      return value === null ? ['null'] : ['other'];
  }
}

const notUndefined = (atom: Atom) => atom !== 'undefined';

/**
 * The kinds of value a schema's output can hold. Each wrapper changes them
 * the way it changes the output type: optional adds undefined, nullable adds
 * null, default, prefault and nonoptional remove undefined.
 */
function atoms(schema: z.core.$ZodType): Atom[] {
  if (schema instanceof z.core.$ZodOptional) {
    return ['undefined', ...atoms(schema._zod.def.innerType)];
  }
  if (schema instanceof z.core.$ZodNullable) {
    return ['null', ...atoms(schema._zod.def.innerType)];
  }
  if (
    schema instanceof z.core.$ZodDefault ||
    schema instanceof z.core.$ZodPrefault ||
    schema instanceof z.core.$ZodNonOptional
  ) {
    return atoms(schema._zod.def.innerType).filter(notUndefined);
  }
  const inner = innerOf(schema);
  if (inner !== undefined) return atoms(inner);
  if (schema instanceof z.core.$ZodUnion) {
    return schema._zod.def.options.flatMap(atoms);
  }
  switch (schema._zod.def.type) {
    case 'string':
      return ['string'];
    case 'number':
      return ['number'];
    case 'boolean':
      return ['boolean'];
    case 'template_literal':
      return ['stringLiteral'];
    case 'enum':
    case 'literal':
      return [...(schema._zod.values ?? [])].flatMap(valueAtoms);
    case 'null':
      return ['null'];
    case 'undefined':
    case 'void':
      return ['undefined'];
    default:
      return ['other'];
  }
}

/** Whether a schema's output can be null or undefined. Mirrors `null extends V`. */
export function nullish(schema: z.core.$ZodType): boolean {
  return atoms(schema).some((atom) => atom === 'null' || atom === 'undefined');
}

/** A field's kind, from its schema. Mirrors `KindOf` above. */
export function kindOf(schema: z.core.$ZodType): Kind {
  const found = atoms(schema).filter(
    (atom) => atom !== 'null' && atom !== 'undefined',
  );
  const only = (...allowed: Atom[]) =>
    found.every((atom) => allowed.includes(atom));
  if (found.length === 0) return 'other';
  if (only('boolean')) return 'boolean';
  if (only('string', 'stringLiteral')) {
    return found.includes('string') ? 'string' : 'enum';
  }
  if (only('number', 'numberLiteral')) {
    return found.includes('number') ? 'number' : 'enum';
  }
  return 'other';
}

/** The schema of a single value an operator compares against. */
function valueSchema(kind: Kind, leaf: z.core.$ZodType): z.core.$ZodType {
  switch (kind) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'enum':
      return leaf;
    default:
      // 'other' fields only take `exists`, which reads no value.
      return z.never();
  }
}

function operandSchema(op: string, value: z.core.$ZodType): z.core.$ZodType {
  switch (op) {
    case 'eq':
    case 'ne':
      return z.nullable(value);
    case 'in':
    case 'nin':
      return z.array(z.nullable(value));
    case 'contains':
      return z.string();
    case 'exists':
      return z.boolean();
    default:
      return value;
  }
}

function fieldSchema(field: z.core.$ZodType): z.core.$ZodType {
  const kind = kindOf(field);
  // An enum's values are checked by its own schema, without wrappers such as
  // catch, which would accept anything.
  const value = valueSchema(kind, unwrap(field));
  return z.strictObject(
    Object.fromEntries(
      Object.entries(operators)
        .filter(([, kinds]) => kinds.some((k) => k === kind))
        .map(([op]) => [op, z.optional(operandSchema(op, value))]),
    ),
  );
}

/**
 * The validator of a `Where` on documents of `schema`. The overload states
 * its static type, as input and output alike: a `Where` has no defaults or
 * transforms. The implementation builds the schema from the shape at
 * runtime, which a loop cannot express as a mapped type.
 */
export function whereSchema<S extends z.ZodObject>(
  schema: S,
): z.ZodType<Where<z.output<S>>, Where<z.output<S>>>;
export function whereSchema(schema: z.ZodObject): z.ZodType {
  const fields = Object.fromEntries(
    Object.entries(schema.shape).map(([name, field]) => [
      name,
      z.optional(fieldSchema(field)),
    ]),
  );
  const clauses = z.optional(z.array(z.lazy(() => where)).min(1));
  const where: z.ZodType = z.strictObject({
    ...fields,
    and: clauses,
    or: clauses,
  });
  return where;
}

/** Parses a `Where` on documents of `schema`, or throws `VALIDATION` naming each path. */
export function parseWhere<S extends z.ZodObject>(
  schema: S,
  value: unknown,
): Where<z.output<S>> {
  const result = whereSchema(schema).safeParse(value);
  if (result.success) return result.data;
  throw invalid(result.error.issues);
}

/** The operators of one field in a parsed `Where`. */
export type FieldOps = {
  readonly eq?: unknown;
  readonly ne?: unknown;
  readonly in?: readonly unknown[];
  readonly nin?: readonly unknown[];
  readonly gt?: unknown;
  readonly gte?: unknown;
  readonly lt?: unknown;
  readonly lte?: unknown;
  readonly contains?: string;
  readonly exists?: boolean;
};

/** Both filters: undefined when neither is set. */
export function both(
  a: AnyWhere | undefined,
  b: AnyWhere | undefined,
): AnyWhere | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { and: [a, b] };
}

/** Any parsed `Where`, as `matches` reads it. */
export type AnyWhere = {
  readonly and?: readonly AnyWhere[];
  readonly or?: readonly AnyWhere[];
  readonly [field: string]: FieldOps | readonly AnyWhere[] | undefined;
};

// Null and missing follow MongoDB's query semantics, so MongoStore can pass a
// Where through unchanged. `eq: null` matches null or missing; `ne` and `nin`
// match a missing field; a comparison with null or missing is false. The one
// difference is `exists`: it asks whether the field has a value, so null does
// not exist (Mongo `{ $ne: null }` and `{ $eq: null }`).
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function equals(value: unknown, target: unknown): boolean {
  return target === null ? !present(value) : value === target;
}

/** Strings compare by code unit, so ISO timestamps order correctly. */
export function compare(value: unknown, target: unknown): number | undefined {
  if (typeof value === 'number' && typeof target === 'number') {
    return value - target;
  }
  if (typeof value === 'string' && typeof target === 'string') {
    return value < target ? -1 : value > target ? 1 : 0;
  }
  return undefined;
}

function compares(
  value: unknown,
  target: unknown,
  test: (order: number) => boolean,
): boolean {
  if (target === undefined) return true;
  const order = compare(value, target);
  return order !== undefined && test(order);
}

function matchesField(value: unknown, ops: FieldOps): boolean {
  if (ops.eq !== undefined && !equals(value, ops.eq)) return false;
  if (ops.ne !== undefined && equals(value, ops.ne)) return false;
  if (ops.in !== undefined && !ops.in.some((t) => equals(value, t))) {
    return false;
  }
  if (ops.nin?.some((t) => equals(value, t))) return false;
  if (!compares(value, ops.gt, (order) => order > 0)) return false;
  if (!compares(value, ops.gte, (order) => order >= 0)) return false;
  if (!compares(value, ops.lt, (order) => order < 0)) return false;
  if (!compares(value, ops.lte, (order) => order <= 0)) return false;
  if (ops.contains !== undefined) {
    // A literal, case-insensitive substring. Never a regex.
    const needle = ops.contains.toLowerCase();
    if (typeof value !== 'string' || !value.toLowerCase().includes(needle)) {
      return false;
    }
  }
  if (ops.exists !== undefined && present(value) !== ops.exists) return false;
  return true;
}

function isClauses(
  condition: FieldOps | readonly AnyWhere[],
): condition is readonly AnyWhere[] {
  return Array.isArray(condition);
}

/** Whether `doc` matches a parsed `where`. The in-memory store's filter. */
export function matches(
  doc: Readonly<Record<string, unknown>>,
  where: AnyWhere,
): boolean {
  for (const [field, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (isClauses(condition)) {
      // collection() rejects fields named `and` and `or`, so only they hold arrays.
      const holds =
        field === 'and'
          ? condition.every((clause) => matches(doc, clause))
          : condition.some((clause) => matches(doc, clause));
      if (!holds) return false;
      continue;
    }
    if (!matchesField(doc[field], condition)) return false;
  }
  return true;
}
