import { z } from 'zod';
import type { Kind } from '../where.js';

function row<S extends z.ZodType, K extends Kind, Sortable extends boolean>(
  schema: S,
  kind: K,
  sortable: Sortable,
) {
  return { schema, kind, sortable };
}

/**
 * Every field form a collection can take, with the kind and sortability it
 * must have. Tests check each row at the type level and at runtime.
 */
export const forms = {
  string: row(z.string(), 'string', true),
  email: row(z.email(), 'string', true),
  isoDatetime: row(z.iso.datetime(), 'string', true),
  brandedString: row(z.string().brand<'Id'>(), 'string', true),
  number: row(z.number(), 'number', true),
  int: row(z.int(), 'number', true),
  brandedNumber: row(z.number().brand<'Cents'>(), 'number', true),
  boolean: row(z.boolean(), 'boolean', false),
  booleanLiteral: row(z.literal(true), 'boolean', false),
  enum: row(z.enum(['a', 'b']), 'enum', true),
  stringLiteral: row(z.literal('a'), 'enum', true),
  numberLiteral: row(z.literal(1), 'enum', true),
  brandedLiteral: row(z.literal('a').brand<'A'>(), 'enum', true),
  literalUnion: row(z.union([z.literal('a'), z.literal('b')]), 'enum', true),
  literalOrString: row(z.union([z.literal('a'), z.string()]), 'string', true),
  mixedScalarUnion: row(z.union([z.string(), z.number()]), 'other', false),
  nullUnion: row(z.union([z.string(), z.null()]), 'string', true),
  templateLiteral: row(z.templateLiteral(['id-', z.number()]), 'enum', true),
  optional: row(z.string().optional(), 'string', true),
  nullable: row(z.number().nullable(), 'number', true),
  default: row(z.boolean().default(false), 'boolean', false),
  optionalThenDefault: row(z.string().optional().default('x'), 'string', true),
  defaultThenOptional: row(z.string().default('x').optional(), 'string', true),
  prefault: row(z.string().prefault('x'), 'string', true),
  nonoptional: row(z.string().optional().nonoptional(), 'string', true),
  readonly: row(z.enum(['a']).readonly(), 'enum', true),
  catch: row(z.number().catch(0), 'number', true),
  optionalCatch: row(z.number().optional().catch(0), 'number', true),
  stacked: row(z.literal('a').nullable().optional().readonly(), 'enum', true),
  wrappedUnionMember: row(
    z.union([z.literal('a').optional(), z.literal('b')]),
    'enum',
    true,
  ),
  null: row(z.null(), 'other', false),
  array: row(z.array(z.string()), 'array', false),
  numberArray: row(z.array(z.number()), 'array', false),
  enumArray: row(z.array(z.enum(['a', 'b'])), 'array', false),
  optionalArray: row(z.array(z.string()).optional(), 'array', false),
  objectArray: row(z.array(z.object({ x: z.number() })), 'other', false),
  booleanArray: row(z.array(z.boolean()), 'other', false),
  object: row(z.object({ x: z.number() }), 'other', false),
};

export type Forms = typeof forms;
