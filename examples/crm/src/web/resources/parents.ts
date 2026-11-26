import type { InferContractInputs } from '@ts-pf/contract';
import type { contract } from '../../servers/rpc/contract.js';

/**
 * The record an activity or a task is on: the page it was made from, or
 * the one picked for it. A contact's and a deal's carry their company.
 */
export type Parent =
  | { readonly on: 'company'; readonly id: string }
  | { readonly on: 'contact'; readonly id: string; readonly companyId: string }
  | { readonly on: 'deal'; readonly id: string; readonly companyId: string };

/** The parent refs an activity or a task records: the same three on both. */
export type Parents = Pick<
  InferContractInputs<typeof contract>['tasks']['create'],
  'companyId' | 'contactId' | 'dealId'
>;

/**
 * The parents an activity or a task records, by the rule: on a deal, the
 * deal and its company; on a contact, the contact and its company; on a
 * company, the company. So a company's timeline or tasks, a filter on
 * companyId alone, show all that happened or is due around it, with no
 * join and no OR. The domain allows any combination; this is how the app
 * writes them.
 *
 * The company is the one at writing time. A contact or deal that later
 * moves to another company leaves its activities and tasks on the old
 * company: they happened, or were asked, with that company.
 */
export function parentsOf(parent: Parent): Parents {
  switch (parent.on) {
    case 'company':
      return { companyId: parent.id };
    case 'contact':
      return { contactId: parent.id, companyId: parent.companyId };
    case 'deal':
      return { dealId: parent.id, companyId: parent.companyId };
  }
}

/** A record's filter: the activities or tasks on that one parent. */
export function whereOn(parent: Parent) {
  switch (parent.on) {
    case 'company':
      return { companyId: { eq: parent.id } };
    case 'contact':
      return { contactId: { eq: parent.id } };
    case 'deal':
      return { dealId: { eq: parent.id } };
  }
}
