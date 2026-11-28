import type { LatticeMeta } from '@latticecms/core';
import type { JsonSchema } from '@ts-pf/docs';

/** What a procedure does to data, from its `mcp` meta. */
export type Effect = 'read' | 'write' | 'destructive';

const effects: readonly Effect[] = ['read', 'write', 'destructive'];

function effectOf(mcp: unknown): Effect | undefined {
  if (!isRecord(mcp)) return undefined;
  return effects.find((effect) => effect === mcp.effect);
}

/** A procedure's docs, as far as the admin reads them. */
export type Docs = {
  readonly summary: string | undefined;
  readonly description: string | undefined;
};

/** A Lattice procedure, as the admin reads it from the served catalog. */
export type Procedure = {
  readonly path: readonly string[];
  readonly lattice: LatticeMeta;
  readonly docs: Docs | undefined;
  /** Its MCP effect: whether it reads, writes, or destroys. */
  readonly effect: Effect | undefined;
  readonly input: JsonSchema | undefined;
  readonly output: JsonSchema | undefined;
  /** The fields `populate` may name, when the procedure populates. */
  readonly expand: readonly string[];
  readonly errors: readonly { readonly code: string }[];
};

/** The catalog the app serves, narrowed to what the admin reads. */
export type Catalog = {
  /** Where procedures are served, such as `/rpc`. */
  readonly prefix: string;
  readonly procedures: readonly Procedure[];
};

/** A catalog, or what made it unreadable. */
export type CatalogRead =
  | { readonly ok: true; readonly catalog: Catalog }
  | { readonly ok: false; readonly reason: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

const operations = [
  'find',
  'count',
  'countBy',
  'get',
  'create',
  'update',
  'delete',
];

function isLabel(value: unknown): value is LatticeMeta['label'] {
  return (
    isRecord(value) &&
    typeof value.singular === 'string' &&
    typeof value.plural === 'string'
  );
}

function isLatticeMeta(value: unknown): value is LatticeMeta {
  if (
    !isRecord(value) ||
    typeof value.collection !== 'string' ||
    !isLabel(value.label)
  ) {
    return false;
  }
  const { operation } = value;
  if (typeof operation !== 'string') return false;
  if (operation === 'list' || operation === 'set') {
    return (
      typeof value.relation === 'string' && typeof value.target === 'string'
    );
  }
  if (operation === 'method') return typeof value.method === 'string';
  return operations.includes(operation);
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined || typeof value === 'string') return value;
  return null;
}

/** The summary and description of a docs entry, or null when unreadable. */
function docsOf(value: unknown): Docs | null {
  if (!isRecord(value)) return null;
  const summary = optionalString(value.summary);
  const description = optionalString(value.description);
  if (summary === null || description === null) return null;
  return { summary, description };
}

/** The JSON Schema of a catalog schema entry, when it has one. */
function jsonSchemaOf(value: unknown): JsonSchema | undefined {
  if (!isRecord(value) || value.kind !== 'json') return undefined;
  return isRecord(value.jsonSchema) ? value.jsonSchema : undefined;
}

function expandOf(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!isRecord(value) || !isRecord(value.fields)) return undefined;
  return Object.keys(value.fields);
}

function errorsOf(value: unknown): readonly { code: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const errors: { code: string }[] = [];
  for (const error of value) {
    if (!isRecord(error) || typeof error.code !== 'string') return undefined;
    errors.push({ code: error.code });
  }
  return errors;
}

/**
 * A procedure entry, or why it cannot be read. An entry without a `lattice`
 * meta key is not a Lattice procedure, and is skipped.
 */
function procedureOf(
  value: unknown,
  at: string,
): Procedure | null | { reason: string } {
  const named = `The catalog's ${at}`;
  if (!isRecord(value)) return { reason: `${named} is not an object.` };
  if (!isStringArray(value.path)) return { reason: `${named} has no path.` };
  if (!isRecord(value.meta)) return { reason: `${named} has no meta.` };
  const { lattice } = value.meta;
  if (lattice === undefined) return null;
  if (!isLatticeMeta(lattice)) {
    return { reason: `${named}.meta.lattice is not Lattice's procedure meta.` };
  }
  const docs =
    value.meta.docs === undefined ? undefined : docsOf(value.meta.docs);
  if (docs === null) {
    return {
      reason: `${named}.meta.docs has a summary or description that is not text.`,
    };
  }
  const expand = expandOf(value.expand);
  if (expand === undefined) {
    return { reason: `${named}.expand has no fields.` };
  }
  const errors = errorsOf(value.errors);
  if (errors === undefined) {
    return { reason: `${named}.errors is not a list of errors with codes.` };
  }
  return {
    path: value.path,
    lattice,
    docs,
    effect: effectOf(value.meta.mcp),
    input: jsonSchemaOf(value.input),
    output: jsonSchemaOf(value.output),
    expand,
    errors,
  };
}

/**
 * Narrows the JSON the app serves to the catalog the admin reads. It checks
 * only what the admin uses, and says why the first unreadable part fails.
 */
export function readCatalog(value: unknown): CatalogRead {
  if (!isRecord(value))
    return { ok: false, reason: 'It is not a JSON object.' };
  if (value.catalogVersion !== 1) {
    return { ok: false, reason: 'Its catalogVersion is not 1.' };
  }
  if (typeof value.prefix !== 'string') {
    return { ok: false, reason: 'It has no prefix.' };
  }
  if (!Array.isArray(value.procedures)) {
    return { ok: false, reason: 'It has no procedures.' };
  }
  const procedures: Procedure[] = [];
  for (const [index, entry] of value.procedures.entries()) {
    const read = procedureOf(entry, `procedures[${index}]`);
    if (read === null) continue;
    if ('reason' in read) return { ok: false, reason: read.reason };
    procedures.push(read);
  }
  if (procedures.length === 0) {
    return { ok: false, reason: 'None of its procedures has Lattice meta.' };
  }
  return { ok: true, catalog: { prefix: value.prefix, procedures } };
}
