import { ref } from '@latticecms/core';

/**
 * What an activity or a task is about: a company, a contact or a deal. A
 * deleted company or contact takes its activities and tasks with it. A
 * deal's ref restricts, the default: deals.delete archives, so a deal is
 * never removed, core refuses a cascade onto a collection that overrides
 * delete, and an archived deal keeps its history.
 */
export const parentRefs = {
  companyId: ref('companies', { onDelete: 'cascade' }).optional(),
  contactId: ref('contacts', { onDelete: 'cascade' }).optional(),
  dealId: ref('deals').optional(),
};

type Parents = {
  readonly companyId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
};

/**
 * An activity or a task names at least one parent: `.refine(hasParent,
 * parentRequired)`. Create checks it, and so does update, on the document
 * after the change, so an update cannot clear the last parent either.
 */
export const hasParent = (doc: Parents): boolean =>
  doc.companyId !== undefined ||
  doc.contactId !== undefined ||
  doc.dealId !== undefined;

/** Where and how a missing parent is refused. */
export const parentRequired = {
  path: ['companyId'],
  message: 'Give a company, a contact or a deal',
};
