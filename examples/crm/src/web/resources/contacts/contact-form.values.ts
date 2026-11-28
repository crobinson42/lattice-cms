import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
  text,
} from '../../ui/form.js';
import type {
  ContactCreate,
  ContactPatch,
  ContactWithCompany,
} from './contact.js';

/**
 * The form's fields, in its order, each typed by what a create takes. The
 * company is picked, not typed.
 */
export const contactFields = [
  { name: 'name', label: 'Name', widget: 'text', parse: text },
  { name: 'email', label: 'Email', widget: 'email', parse: text },
  { name: 'companyId', label: 'Company', widget: 'company', parse: text },
  {
    name: 'title',
    label: 'Title',
    widget: 'text',
    parse: text,
    optional: true,
  },
  { name: 'phone', label: 'Phone', widget: 'tel', parse: text, optional: true },
] as const satisfies readonly FormField<ContactCreate>[];

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
