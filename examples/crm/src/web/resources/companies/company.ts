import type {
  InferContractInputs,
  InferContractOutputs,
  InferExpandedOutput,
} from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A company, as the API returns it. */
export type Company = InferContractOutputs<typeof contract>['companies']['get'];

/**
 * A company as a populated ref returns it, such as a contact's `companyId`
 * read with `populate`: the company, or `{ id }` when the caller may not
 * read it.
 */
export type CompanyRef = InferExpandedOutput<
  (typeof contract)['contacts']['get'],
  ['companyId']
>['companyId'];

/** Whether the caller may read the populated company: it has its fields. Every
 * populated document has `createdAt`; `Withheld` is only `{ id }`. */
export function isReadableCompany(
  company: CompanyRef,
): company is Extract<CompanyRef, { readonly createdAt: string }> {
  return 'createdAt' in company;
}

type Inputs = InferContractInputs<typeof contract>['companies'];

/** What creating a company takes. */
export type CompanyCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type CompanyPatch = Omit<Inputs['update'], 'id'>;
