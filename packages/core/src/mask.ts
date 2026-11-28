import { z } from 'zod';
import { CallAccess } from './access.js';
import { LatticeError } from './errors.js';
import { type Masked, marked, markOf } from './marker.js';
import { innerOf } from './where.js';

/** `Shape` with each maskable field optional, as a client may receive it. */
export type MaskShape<Shape extends z.core.$ZodShape, M extends string> = {
  [K in keyof Shape]: K extends M ? z.ZodOptional<Shape[K]> : Shape[K];
};

/**
 * The shapes a collection's outputs are built from: `stored`, with each
 * maskable field marked, and `client`, with each marked and optional.
 */
export function maskShapes<Shape extends z.core.$ZodShape, M extends string>(
  slug: string,
  shape: Shape,
  maskable: readonly M[],
): { readonly stored: Shape; readonly client: MaskShape<Shape, M> };
export function maskShapes(
  slug: string,
  shape: z.core.$ZodShape,
  maskable: readonly string[],
): { readonly stored: z.core.$ZodShape; readonly client: z.core.$ZodShape } {
  const stored: Record<string, z.core.$ZodType> = { ...shape };
  const client: Record<string, z.core.$ZodType> = { ...shape };
  for (const field of maskable) {
    const schema = shape[field];
    if (schema === undefined) continue;
    const mark = marked(schema, { collection: slug, field });
    stored[field] = mark;
    // The description reaches JSON Schema, so OpenAPI and MCP say why.
    client[field] = z
      .optional(mark)
      .describe('Withheld when the caller may not read it.');
  }
  return { stored, client };
}

/**
 * Where in an output a withheld field is removed. Built once per procedure
 * from its output schema; only the parts that hold a masked field.
 */
export type MaskPlan =
  | {
      readonly kind: 'object';
      readonly keys: ReadonlyMap<
        string,
        { readonly masked?: Masked; readonly child?: MaskPlan }
      >;
    }
  | { readonly kind: 'array'; readonly item: MaskPlan }
  | { readonly kind: 'record'; readonly value: MaskPlan }
  | {
      readonly kind: 'tuple';
      readonly items: readonly (MaskPlan | undefined)[];
      readonly rest: MaskPlan | undefined;
    }
  // A union or an intersection: the value may match any branch, so every
  // branch's masks apply. A key is only ever removed, so this can over-mask
  // a same-named key of another branch, never under-mask.
  | { readonly kind: 'each'; readonly plans: readonly MaskPlan[] };

/** The name of a schema kind Lattice cannot see through, or undefined. */
function opaque(schema: z.core.$ZodType): string | undefined {
  if (schema instanceof z.core.$ZodLazy) return 'z.lazy()';
  if (schema instanceof z.core.$ZodPipe) return 'a pipe or transform';
  if (schema instanceof z.core.$ZodTransform) return 'a transform';
  if (schema instanceof z.core.$ZodCustom) return 'z.custom()';
  if (schema instanceof z.core.$ZodAny) return 'z.any()';
  if (schema instanceof z.core.$ZodUnknown) return 'z.unknown()';
  if (schema instanceof z.core.$ZodPromise) return 'z.promise()';
  return undefined;
}

/**
 * The mask plan of an output schema, or undefined when nothing in it is
 * masked. `where` names the procedure, for errors. It sees through objects,
 * arrays, records, tuples, unions, intersections and the optional, nullable,
 * default, readonly and catch wrappers. A schema it cannot see through
 * throws, so no masked field can hide inside one. A masked field must be
 * optional where it sits: a client may not receive it.
 */
export function maskPlan(
  schema: z.core.$ZodType,
  where: string,
): MaskPlan | undefined {
  const fail = (message: string): never => {
    throw new Error(`Lattice: the output of "${where}" ${message}`);
  };
  const visit = (node: z.core.$ZodType): MaskPlan | undefined => {
    const mark = markOf(node);
    if (mark !== undefined) {
      fail(
        `holds ${mark.collection}.${mark.field} where it is required; declare it optional: use the collection's clientOutput`,
      );
    }
    const kind = opaque(node);
    if (kind !== undefined) {
      fail(
        `has ${kind}, which Lattice cannot see through to mask a field; declare a plain schema`,
      );
    }
    const inner = innerOf(node);
    if (inner !== undefined) return visit(inner);
    if (node instanceof z.core.$ZodObject) {
      const keys = new Map<string, { masked?: Masked; child?: MaskPlan }>();
      for (const [key, field] of Object.entries(node._zod.def.shape)) {
        const found = maskedField(field);
        if (found !== undefined) {
          if (!found.optional) {
            fail(
              `holds ${found.masked.collection}.${found.masked.field} where it is required, as "${key}"; declare it optional: use the collection's clientOutput`,
            );
          }
          keys.set(key, { masked: found.masked });
          continue;
        }
        const child = visit(field);
        if (child !== undefined) keys.set(key, { child });
      }
      return keys.size === 0 ? undefined : { kind: 'object', keys };
    }
    if (node instanceof z.core.$ZodArray) {
      const item = visit(node._zod.def.element);
      return item === undefined ? undefined : { kind: 'array', item };
    }
    if (node instanceof z.core.$ZodRecord) {
      const value = visit(node._zod.def.valueType);
      return value === undefined ? undefined : { kind: 'record', value };
    }
    if (node instanceof z.core.$ZodTuple) {
      const items = node._zod.def.items.map(visit);
      const { rest: restSchema } = node._zod.def;
      const rest = restSchema === null ? undefined : visit(restSchema);
      return items.every((item) => item === undefined) && rest === undefined
        ? undefined
        : { kind: 'tuple', items, rest };
    }
    const branches =
      node instanceof z.core.$ZodUnion
        ? node._zod.def.options
        : node instanceof z.core.$ZodIntersection
          ? [node._zod.def.left, node._zod.def.right]
          : [];
    const plans = branches.flatMap((branch) => visit(branch) ?? []);
    return plans.length === 0 ? undefined : { kind: 'each', plans };
  };
  return visit(schema);
}

/**
 * The masked field an object property holds, seen through its wrappers, and
 * whether the property may be absent. Undefined for an unmasked property.
 */
function maskedField(
  field: z.core.$ZodType,
): { masked: Masked; optional: boolean } | undefined {
  let current: z.core.$ZodType | undefined = field;
  let optional = false;
  while (current !== undefined) {
    if (current instanceof z.core.$ZodOptional) optional = true;
    const mark = markOf(current);
    if (mark !== undefined) return { masked: mark, optional };
    current = innerOf(current);
  }
  return undefined;
}

/** The collections a plan masks fields of. */
export function maskedCollections(plan: MaskPlan): Set<string> {
  const slugs = new Set<string>();
  const visit = (node: MaskPlan): void => {
    switch (node.kind) {
      case 'object':
        for (const { masked, child } of node.keys.values()) {
          if (masked !== undefined) slugs.add(masked.collection);
          if (child !== undefined) visit(child);
        }
        return;
      case 'array':
        visit(node.item);
        return;
      case 'record':
        visit(node.value);
        return;
      case 'tuple':
        for (const item of node.items) if (item !== undefined) visit(item);
        if (node.rest !== undefined) visit(node.rest);
        return;
      case 'each':
        for (const plan of node.plans) visit(plan);
    }
  };
  visit(plan);
  return slugs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` with each field `withheld` says to remove taken out, where `plan`
 * puts one. It copies what it changes, so a document the use case still
 * holds is not changed.
 */
export function applyMask(
  plan: MaskPlan,
  value: unknown,
  withheld: (masked: Masked) => boolean,
): unknown {
  switch (plan.kind) {
    case 'object': {
      if (!isRecord(value)) return value;
      let out: Record<string, unknown> | undefined;
      for (const [key, { masked, child }] of plan.keys) {
        if (!Object.hasOwn(value, key)) continue;
        out ??= { ...value };
        if (masked !== undefined && withheld(masked)) {
          delete out[key];
        } else if (child !== undefined) {
          out[key] = applyMask(child, value[key], withheld);
        }
      }
      return out ?? value;
    }
    case 'array':
      return Array.isArray(value)
        ? value.map((item) => applyMask(plan.item, item, withheld))
        : value;
    case 'record':
      return isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              applyMask(plan.value, item, withheld),
            ]),
          )
        : value;
    case 'tuple':
      return Array.isArray(value)
        ? value.map((item, index) => {
            const itemPlan =
              index < plan.items.length ? plan.items[index] : plan.rest;
            return itemPlan === undefined
              ? item
              : applyMask(itemPlan, item, withheld);
          })
        : value;
    case 'each':
      return plan.plans.reduce(
        (current, branch) => applyMask(branch, current, withheld),
        value,
      );
  }
}

/**
 * Refuses, as VALIDATION, a `where` or `sort` on find or count, or an
 * update patch, that names a field withheld from the caller (0031, 0035).
 * A query would reveal it through which rows match or their order, and an
 * update would change a value the caller cannot see. The family guard runs
 * it on every use case, and the generated bodies run it again (0036), so a
 * body called from an override skips nothing.
 */
export async function refuseWithheld(
  access: CallAccess,
  collection: {
    readonly slug: string;
    readonly maskable: readonly string[];
  },
  action: string,
  input: unknown,
): Promise<void> {
  if (action !== 'find' && action !== 'count' && action !== 'update') return;
  const withheld = await CallAccess.withheld(access, collection);
  if (withheld.size === 0) return;
  const issues =
    action === 'update'
      ? withheldWrites(input, withheld)
      : withheldPaths(input, withheld);
  if (issues.length > 0) throw LatticeError.VALIDATION({ issues });
}

/**
 * The keys of an update's patch that name a withheld field, for VALIDATION
 * issues (0035): a caller cannot change, or clear, what it cannot read.
 */
function withheldWrites(
  input: unknown,
  withheld: ReadonlySet<string>,
): { path: (string | number)[]; message: string }[] {
  if (!isRecord(input)) return [];
  return Object.entries(input)
    .filter(([key, value]) => value !== undefined && withheld.has(key))
    .map(([key]) => ({
      path: [key],
      message: `"${key}" is not readable, so it cannot be changed`,
    }));
}

/** The where and sort paths that name a withheld field, for VALIDATION issues. */
function withheldPaths(
  input: unknown,
  withheld: ReadonlySet<string>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const message = (field: string) => `"${field}" is not readable`;
  const where = (node: unknown, path: (string | number)[]): void => {
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'and' || key === 'or') && Array.isArray(value)) {
        value.forEach((clause, index) => {
          where(clause, [...path, key, index]);
        });
      } else if (withheld.has(key)) {
        issues.push({ path: [...path, key], message: message(key) });
      }
    }
  };
  if (!isRecord(input)) return issues;
  where(input.where, ['where']);
  const { sort } = input;
  if (Array.isArray(sort)) {
    sort.forEach((key, index) => {
      if (typeof key !== 'string') return;
      const field = key.startsWith('-') ? key.slice(1) : key;
      if (withheld.has(field)) {
        issues.push({ path: ['sort', index], message: message(field) });
      }
    });
  }
  return issues;
}
