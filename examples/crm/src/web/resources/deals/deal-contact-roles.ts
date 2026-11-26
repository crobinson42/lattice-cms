import type { InferContractInputs } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';
import { oneOf } from '../../ui/form.js';

type Links = InferContractInputs<typeof contract>['deals']['contacts']['set'];

/** One contact on a deal, as `set` takes it: who, and what they are to it. */
export type DealContactLink = Links['links'][number];

export type DealContactRole = DealContactLink['role'];

/** How each role reads. */
export const dealContactRoles: Readonly<Record<DealContactRole, string>> = {
  decision_maker: 'Decision maker',
  champion: 'Champion',
  other: 'Other',
};

const roles = [
  'decision_maker',
  'champion',
  'other',
] as const satisfies readonly DealContactRole[];

/** The roles, in the order a select offers them. */
export const roleOptions = roles.map((role) => ({
  value: role,
  label: dealContactRoles[role],
}));

/** A role, as a select of them gives it. */
export const parseRole = oneOf(roles);

/**
 * The deal's contacts after adding one, or changing their role if they are
 * on it already. `set` replaces the whole list, so a change sends it all.
 */
export function withContact(
  links: readonly DealContactLink[],
  added: DealContactLink,
): DealContactLink[] {
  return links.some(({ contactsId }) => contactsId === added.contactsId)
    ? links.map((link) => (link.contactsId === added.contactsId ? added : link))
    : [...links, added];
}

/** The deal's contacts without one. */
export function withoutContact(
  links: readonly DealContactLink[],
  contactsId: string,
): DealContactLink[] {
  return links.filter((link) => link.contactsId !== contactsId);
}
