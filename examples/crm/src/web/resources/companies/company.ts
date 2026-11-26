import type {
  InferContractInputs,
  InferContractOutputs,
} from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A company, as the API returns it. */
export type Company = InferContractOutputs<typeof contract>['companies']['get'];

type Inputs = InferContractInputs<typeof contract>['companies'];

/** What creating a company takes. */
export type CompanyCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type CompanyPatch = Omit<Inputs['update'], 'id'>;
