import type { InferContractOutputs } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A member of an organization: a user's membership there, as read. */
export type Member = InferContractOutputs<
  typeof contract
>['memberships']['find']['docs'][number];
