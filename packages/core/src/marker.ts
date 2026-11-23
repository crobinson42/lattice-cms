import { z } from 'zod';

/** A maskable field as the marker records it: its collection and name. */
export type Masked = { readonly collection: string; readonly field: string };

/**
 * The check that marks a maskable field. It accepts every value, and a
 * clone keeps its checks, so `.pick()`, `.extend()` and `shape.amount`
 * all carry it (as a ref's marker does).
 */
type MaskMarker = z.core.$ZodCheck<unknown> & {
  readonly '~lattice-mask': Masked;
};

function isMaskMarker(check: unknown): check is MaskMarker {
  return (
    typeof check === 'object' && check !== null && '~lattice-mask' in check
  );
}

/** The field a schema node is marked as, or undefined. */
export function markOf(schema: z.core.$ZodType): Masked | undefined {
  return (schema._zod.def.checks ?? []).find(isMaskMarker)?.['~lattice-mask'];
}

/** `schema` with the mask marker added: a clone, never the app's schema. */
export function marked<T extends z.core.$ZodType>(
  schema: T,
  masked: Masked,
): T {
  const marker: MaskMarker = Object.assign(
    z.check<unknown>(() => {}),
    {
      '~lattice-mask': masked,
    },
  );
  const { def } = schema._zod;
  return z.core.util.clone(schema, {
    ...def,
    checks: [...(def.checks ?? []), marker],
  });
}
