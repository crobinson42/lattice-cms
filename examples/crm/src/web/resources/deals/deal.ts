import type { InferContractInputs, InferExpandedOutput } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';
import type { Member } from '../members/member.js';

/** A deal, as the API returns it. A member receives no amount. */
export type Deal = InferExpandedOutput<(typeof contract)['deals']['get'], []>;

/**
 * A deal read with `populate: ['companyId']`: `companyId` is the company,
 * or `{ id }` when the caller may not read it.
 */
export type DealWithCompany = InferExpandedOutput<
  (typeof contract)['deals']['get'],
  ['companyId']
>;

/**
 * A deal as a populated ref returns it, such as an activity's `dealId` read
 * with `populate`: the deal, or `{ id }` when the caller may not read it.
 */
export type DealRef = NonNullable<
  InferExpandedOutput<
    (typeof contract)['activities']['find'],
    ['dealId']
  >['docs'][number]['dealId']
>;

/** Whether the caller may read the populated deal: it has its fields. Every
 * populated document has `createdAt`; `Withheld` is only `{ id }`. */
export function isReadableDeal(
  deal: DealRef,
): deal is Extract<DealRef, { readonly createdAt: string }> {
  return 'createdAt' in deal;
}

type Inputs = InferContractInputs<typeof contract>['deals'];

/** What creating a deal takes. */
export type DealCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type DealPatch = Omit<Inputs['update'], 'id'>;

/** What a read of deals filters on. */
export type DealWhere = NonNullable<Inputs['find']['where']>;

/** How a deal closes. */
export type DealOutcome = Inputs['close']['outcome'];

/** Deals whose title holds the search: all of them for an empty one. */
export function dealTitleSearch(q: string): DealWhere {
  return q === '' ? {} : { title: { contains: q } };
}

/**
 * Whether the signed-in member reads amounts: managers do, as the
 * contract's field rule for `amount` says. A missing amount on a deal is
 * not the sign: a deal a manager reads always has one.
 */
export function readsAmounts(me: Member | undefined): boolean {
  return me?.role === 'manager';
}
