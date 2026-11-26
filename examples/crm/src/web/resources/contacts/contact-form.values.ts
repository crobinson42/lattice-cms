import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
} from '../../ui/form.js';
import type {
  ContactCreate,
  ContactPatch,
  ContactWithCompany,
} from './contact.js';

/** The form's fields, in its order. The company is picked, not typed. */
export const contactFields = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'companyId', label: 'Company', type: 'company' },
  { name: 'title', label: 'Title', type: 'text', optional: true },
  { name: 'phone', label: 'Phone', type: 'tel', optional: true },
] as const satisfies readonly FormField[];

export type ContactField = (typeof contactFields)[number]['name'];

/**
 * The form's starting values: the contact's, or empty for a new one. The
 * company is its id, readable or not, which is what the select submits
 * until the user picks another.
 */
export function valuesOf(
  contact: ContactWithCompany | undefined,
): FormValues<ContactField> {
  return (field) =>
    field === 'companyId'
      ? (contact?.companyId.id ?? '')
      : (contact?.[field] ?? '');
}

/** A new contact from the form. */
export function createInput(values: FormValues<ContactField>): ContactCreate {
  const input: ContactCreate = { name: '', email: '', companyId: '' };
  fillCreate(input, contactFields, values);
  return input;
}

/** Only what the form changed. */
export function patchOf(
  contact: ContactWithCompany,
  values: FormValues<ContactField>,
): ContactPatch {
  const patch: ContactPatch = {};
  fillPatch(patch, contactFields, valuesOf(contact), values);
  return patch;
}
