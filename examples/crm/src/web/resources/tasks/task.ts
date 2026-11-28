import type { InferContractInputs, InferExpandedOutput } from '@ts-pf/contract';
import type { contract } from '../../../servers/rpc/contract.js';

type Inputs = InferContractInputs<typeof contract>['tasks'];

/**
 * A task as a list reads it: its company, contact and deal populated, each
 * the document, or `{ id }` when the caller may not read it.
 */
export type Task = InferExpandedOutput<
  (typeof contract)['tasks']['find'],
  ['companyId', 'contactId', 'dealId']
>['docs'][number];

/** What creating a task takes. */
export type TaskCreate = Inputs['create'];

/** The fields an edit changes. */
export type TaskPatch = Omit<Inputs['update'], 'id'>;

/** Which tasks a list reads. */
export type TaskWhere = NonNullable<Inputs['find']['where']>;

/** How a list of tasks is sorted. */
export type TaskSort = NonNullable<Inputs['find']['sort']>;
