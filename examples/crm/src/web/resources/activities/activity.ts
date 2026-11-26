import type { InferContractInputs, InferExpandedOutput } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

type Procedures = (typeof contract)['activities'];
type Inputs = InferContractInputs<typeof contract>['activities'];

/**
 * An activity as a timeline reads it: its deal and its contact populated,
 * each the document, or `{ id }` when the caller may not read it.
 */
export type Activity = InferExpandedOutput<
  Procedures['find'],
  ['dealId', 'contactId']
>['docs'][number];

/** What logging an activity takes: activities.log stamps the author. */
export type ActivityLog = Inputs['log'];

/** The fields an edit changes. */
export type ActivityPatch = Omit<Inputs['update'], 'id'>;

/** What an activity is about, by the parents rule (activity-parents.ts). */
export type ActivityParents = Pick<
  ActivityLog,
  'companyId' | 'contactId' | 'dealId'
>;
