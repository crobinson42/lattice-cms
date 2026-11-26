# Brief for ts-pf: `InferContractErrors` drops protocol errors

For the ts-pf maintainers, from Lattice CMS. Found on ts-pf 1.0.1, TypeScript 6, 2026-11-26, while building the crm's web app. Not yet confirmed by ts-pf.

## The problem

`InferContractErrors<typeof contract>['x']['y']` gives a procedure's declared error codes only. The protocol errors that every call can return, `VALIDATION` among them, are missing. A client that types its refusals from the contract cannot narrow `error.code === 'VALIDATION'` to show issues at a form's fields.

The client types a call's error correctly. `asResult(rpc.things.create(input))` gives a union that includes `VALIDATION`. So does `ClientError<…>` written out with a concrete procedure. Any generic alias over `ClientError<InferContractProcedure<P>['errors']>` loses them the same way `InferContractErrors` does.

## The repro

```ts
import { procedure, router, type InferContractErrors } from '@ts-pf/contract';
import { z } from 'zod';

const contract = router({
  things: router({
    create: procedure
      .input(z.object({ name: z.string() }))
      .output(z.null())
      .errors({ GONE: { status: 410, message: 'gone' } }),
  }),
});

type Codes = InferContractErrors<typeof contract>['things']['create']['code'];
// Expected: 'GONE' | 'VALIDATION' | … (the protocol errors)
// Actual:   'GONE'
```

## What Lattice does meanwhile

`examples/crm/src/web/resources/companies/company.ts` writes its write and delete error types out, with a comment naming this ts-pf version. Each later resource would copy that.

## What Lattice needs

`InferContractErrors` (and the generic `ClientError` form) to include the protocol errors, as the client's call types do. If dropping them is intended, a note in the contract README saying which helper gives a call's full error type.
