---
'@latticecms/core': patch
---

An access `Where` fails closed. Lattice checks each one at runtime, from an access function or a `build({ access })` adapter, before the query runs. These throw an `Error` that names the path:

- an undefined operand;
- a field key whose value is `undefined` (leave the key out instead);
- a field with no operator, such as `{ ownerId: {} }`;
- an unknown field or operator;
- an operand of the wrong type.

Before, an undefined operand dropped its clause and widened the filter: `{ organizationId: { eq: actor.orgId } }` with no `orgId` read every row. An empty `or` is allowed and matches nothing. An empty `and` matches every row.

`tenancy.scope(C, tenantId)` throws when `tenantId` is not a non-empty string, as `tenantOf`'s answer does.
