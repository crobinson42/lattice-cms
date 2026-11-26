import type {
  InferContractInputs,
  InferContractOutputs,
  InferExpandedOutput,
} from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A contact, as the API returns it: `companyId` is the company's id. */
export type Contact = InferContractOutputs<typeof contract>['contacts']['get'];

/**
 * A contact read with `populate: ['companyId']`: `companyId` is the company,
 * or `{ id }` when the caller may not read it.
 */
export type ContactWithCompany = InferExpandedOutput<
  (typeof contract)['contacts']['get'],
  ['companyId']
>;

type Inputs = InferContractInputs<typeof contract>['contacts'];

/** What creating a contact takes. */
export type ContactCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type ContactPatch = Omit<Inputs['update'], 'id'>;
