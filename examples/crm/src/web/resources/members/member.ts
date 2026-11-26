import type { InferContractOutputs } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A member of an organization: a user's membership there, as read. */
export type Member = InferContractOutputs<
  typeof contract
>['memberships']['find']['docs'][number];

/** The team's member with this user id, or undefined if the team has none. */
export function memberOf(
  members: readonly Member[],
  userId: string | undefined,
): Member | undefined {
  return userId === undefined
    ? undefined
    : members.find((member) => member.userId === userId);
}
