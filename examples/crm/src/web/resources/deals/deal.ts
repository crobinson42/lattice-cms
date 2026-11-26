import type {
  InferContractInputs,
  InferContractOutputs,
  InferExpandedOutput,
} from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';
import type { Member } from '../members/member.js';

/** A deal, as the API returns it. A member receives no amount. */
export type Deal = InferContractOutputs<typeof contract>['deals']['get'];

/**
 * A deal read with `populate: ['companyId']`: `companyId` is the company,
 * or `{ id }` when the caller may not read it.
 */
export type DealWithCompany = InferExpandedOutput<
  (typeof contract)['deals']['get'],
  ['companyId']
>;

type Inputs = InferContractInputs<typeof contract>['deals'];

/** What creating a deal takes. */
export type DealCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type DealPatch = Omit<Inputs['update'], 'id'>;

/**
 * Whether the signed-in member reads amounts: managers do, as the
 * contract's field rule for `amount` says. A missing amount on a deal is
 * not the sign: a deal a manager reads always has one.
 */
export function readsAmounts(me: Member | undefined): boolean {
  return me?.role === 'manager';
}
