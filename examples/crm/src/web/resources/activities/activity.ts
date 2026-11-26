import type { InferContractInputs, InferExpandedOutput } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

type Procedures = (typeof contract)['activities'];
type Inputs = InferContractInputs<typeof contract>['activities'];

/**
 * An activity as a timeline reads it: its company, deal and contact
 * populated, each the document, or `{ id }` when the caller may not read
 * it. `activityPopulate` is that list, for every read of one.
 */
export type Activity = InferExpandedOutput<
  Procedures['find'],
  ['companyId', 'dealId', 'contactId']
>['docs'][number];

/** What every read of activities populates: spread, it stays a tuple. */
export const activityPopulate = ['companyId', 'dealId', 'contactId'] as const;

/** What logging an activity takes: activities.log stamps the author. */
export type ActivityLog = Inputs['log'];

/** The fields an edit changes. */
export type ActivityPatch = Omit<Inputs['update'], 'id'>;
