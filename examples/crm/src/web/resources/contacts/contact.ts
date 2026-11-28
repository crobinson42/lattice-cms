import type { InferContractInputs, InferExpandedOutput } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

/** A contact, as the API returns it: `companyId` is the company's id. */
export type Contact = InferExpandedOutput<
  (typeof contract)['contacts']['get'],
  []
>;

/**
 * A contact read with `populate: ['companyId']`: `companyId` is the company,
 * or `{ id }` when the caller may not read it.
 */
export type ContactWithCompany = InferExpandedOutput<
  (typeof contract)['contacts']['get'],
  ['companyId']
>;

/**
 * A contact as a populated ref returns it, such as an activity's
 * `contactId` read with `populate`: the contact, or `{ id }` when the
 * caller may not read it.
 */
export type ContactRef = NonNullable<
  InferExpandedOutput<
    (typeof contract)['activities']['find'],
    ['contactId']
  >['docs'][number]['contactId']
>;

/** Whether the caller may read the populated contact: it has its fields. Every
 * populated document has `createdAt`; `Withheld` is only `{ id }`. */
export function isReadableContact(
  contact: ContactRef,
): contact is Extract<ContactRef, { readonly createdAt: string }> {
  return 'createdAt' in contact;
}

type Inputs = InferContractInputs<typeof contract>['contacts'];

/** What creating a contact takes. */
export type ContactCreate = Inputs['create'];

/** The fields an edit changes: `null` clears an optional one. */
export type ContactPatch = Omit<Inputs['update'], 'id'>;
