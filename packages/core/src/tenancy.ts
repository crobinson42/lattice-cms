import { z } from 'zod';
import type { AnyCollection } from './collection.js';
import type { AnyWhere } from './where.js';

/**
 * What `tenantOf` returns for a platform actor, such as support staff: the
 * call reads across tenants. A bypass is read-only on tenanted collections,
 * and each bypassed scope is logged (0024).
 */
const bypass: unique symbol = Symbol('lattice.tenancy.bypass');

/** What a family's `tenantOf` returns: a tenant id, or `tenancy.bypass`. */
export type Tenant = string | typeof bypass;

/**
 * A collection's filter for one call: what `Repo` calls run under. It is the
 * tenant clause ANDed with the access `Where`. `tenantId` is the tenant a
 * write is stamped with: undefined for a global collection, and for a
 * bypass, which cannot write a tenanted collection.
 */
export class Scope<Slug extends string = string> {
  // A private field makes the type nominal: a plain object with the same
  // fields is not a Scope, so no app can hand a repo a filter it made up.
  readonly #scope = true;

  constructor(
    readonly collection: Slug,
    readonly where: AnyWhere | undefined,
    readonly tenantId: string | undefined,
  ) {
    // Read once so noUnusedLocals keeps the brand, as hexok's Port does.
    void this.#scope;
  }
}

/** The tenant field of a collection with one, or never. */
export type TenantField<C extends { readonly tenant: string | undefined }> =
  Exclude<C['tenant'], undefined>;

/**
 * The tenant field's pieces, from its name: the `tenant` value a collection
 * carries, the output shape that adds the field, and the event shape that
 * adds `tenantId`. Each is empty without a tenant. The overload states the
 * key and the conditional types; a computed key types as an index
 * signature.
 */
export function tenantShapes<T extends string>(
  tenant: T | undefined,
): {
  readonly tenant: [T] extends [never] ? undefined : T;
  readonly field: Record<T, z.ZodString>;
  readonly event: [T] extends [never]
    ? Record<never, never>
    : { tenantId: z.ZodString };
};
export function tenantShapes(tenant: string | undefined): {
  readonly tenant: string | undefined;
  readonly field: Record<string, z.ZodString>;
  readonly event: Record<string, z.ZodString>;
} {
  return tenant === undefined
    ? { tenant, field: {}, event: {} }
    : {
        tenant,
        // The meta says which field is the tenant's, so a client such as
        // the admin shows it read-only without guessing.
        field: { [tenant]: z.string().meta({ 'x-lattice-tenant': true }) },
        event: { tenantId: z.string() },
      };
}

/** The filter that keeps a call inside one tenant, or none. */
export function tenantClause(
  collection: AnyCollection,
  tenant: Tenant | undefined,
): AnyWhere | undefined {
  const field = collection.tenant;
  if (field === undefined || tenant === undefined || tenant === bypass) {
    return undefined;
  }
  return { [field]: { eq: tenant } };
}

/**
 * `record` without `collection`'s tenant field. Update writes only the
 * schema's fields: the tenant is stamped once, on create.
 */
export function withoutTenant(
  collection: AnyCollection,
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { tenant } = collection;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== tenant),
  );
}

/** A collection with a tenant field. */
type Tenanted = AnyCollection & { readonly tenant: string };

/**
 * The scope of server code that works inside one tenant, such as an event
 * handler: the tenant clause and no access. Writes through it are stamped
 * with `tenantId`.
 */
function scope<C extends Tenanted>(
  collection: C,
  tenantId: string,
): Scope<C['slug']> {
  if (collection.tenant === undefined) {
    throw new Error(`Lattice: "${collection.slug}" has no tenant field`);
  }
  return new Scope(
    collection.slug,
    tenantClause(collection, tenantId),
    tenantId,
  );
}

/** Tenancy for server code: the platform bypass, and a tenant's scope. */
export const tenancy: {
  readonly bypass: typeof bypass;
  readonly scope: typeof scope;
} = { bypass, scope };
