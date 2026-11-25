# Brief for hexok: `family()` statics cost ~38k instantiations per spec

For the hexok maintainers, from Lattice CMS. Measured on hexok 2.2.7, TypeScript 6, 2026-11-25.

## The problem

A use case family factory types its statics as `ReservedOk<S> & Spec` (`packages/hexok/src/use-case.ts:304-309`):

```ts
const factory = function family<
  const Token extends string,
  const S extends [keyof Spec] extends [never] ? NoStatics : Spec,
>(
  token: Token,
  ...args: [keyof Spec] extends [never] ? [] : [statics: ReservedOk<S> & Spec]
)
```

Intersecting the inferred `S` with `Spec` makes TypeScript build each property's intersection member by member, and check the argument against it. When a spec property is a large generic type, that is expensive. Lattice's spec has `collection: AnyCollection`, a wide Zod-backed type. For each collection that gets a hand-written use case, `Collection<'deals', …> & AnyCollection` is built: `ZodObject<Shape> & ZodObject<$ZodShape>` for its schema, its outputs and the rest.

## The measurements

In a Lattice app with six collections (217,656 instantiations as the base), declaring one function with each signature and calling it once with a collection:

| Signature | Added instantiations |
| --- | --- |
| `fam<S extends FamilySpec>(s: S)` | +2 |
| `fam<const S extends FamilySpec>(s: ReservedOk<S> & FamilySpec)` (today's shape) | +38,268 |
| `fam<const S extends FamilySpec>(s: S & ReservedOk<S>)` (proposed) | +22 |
| A real `AppUseCase('c0.peek', { collection: C0, … })` | +52,577 (the other ~14k is the returned class type) |

The cost is paid once per collection that has a hand-written use case. A second use case on the same collection adds about 7k. In Lattice's example CRM, it is about 76k of a 635k check. An app with a method on each of 12 collections pays about 450k for it.

## The proposed fix

```ts
...args: [keyof Spec] extends [never] ? [] : [statics: S & ReservedOk<S>]
```

`S extends Spec` already requires the spec, so the intersection with `Spec` adds no check. `ReservedOk<S>` still turns a reserved static (`token`, `prototype`, `name`, `length`) into `never`, so the call still fails there.

Check before releasing:

- A reserved static is still a compile error at that property.
- A missing required spec key is still a compile error.
- Function-valued statics are still contextually typed (`S`'s constraint provides it).
- Excess-property behavior matches today's. `S` is inferred from the argument either way, so extra keys flow into `S` as before.
- `Statics<S>` and the returned class's static types are unchanged.

## The repro

With Lattice's core built (`npm run build` in lattice-cms), in a file under `examples/crm/` with a `tsconfig` that extends `tsconfig.base.json`, run `npx tsc --noEmit --extendedDiagnostics` and compare `Instantiations` with and without the last two lines:

```ts
import { collection } from '@latticecms/core';
import type { FamilySpec } from '../../packages/core/dist/family.js';
import { z } from 'zod';

const C0 = collection('c0', { schema: z.object({ name: z.string() }), tenant: 'orgId' });

type ReservedOk<S> = { [K in keyof S]: K extends 'token' | 'prototype' | 'name' | 'length' ? never : S[K] };
declare function today<const S extends FamilySpec>(s: ReservedOk<S> & FamilySpec): S;
declare function proposed<const S extends FamilySpec>(s: S & ReservedOk<S>): S;

export const a = today({ collection: C0 });    // about +38k
export const b = proposed({ collection: C0 }); // about +22
```

## What Lattice needs

A patch release with the new signature. Lattice re-measures and lowers its type budgets when it lands. No Lattice API changes.
