import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
  text,
} from '../../ui/form.js';
import type { Company, CompanyCreate, CompanyPatch } from './company.js';

/** The form's fields, in its order, each typed by what a create takes. */
export const companyFields = [
  { name: 'name', label: 'Name', widget: 'text', parse: text },
  {
    name: 'domain',
    label: 'Domain',
    widget: 'text',
    parse: text,
    optional: true,
  },
  {
    name: 'industry',
    label: 'Industry',
    widget: 'text',
    parse: text,
    optional: true,
  },
  { name: 'phone', label: 'Phone', widget: 'tel', parse: text, optional: true },
] as const satisfies readonly FormField<CompanyCreate>[];

export type CompanyField = (typeof companyFields)[number]['name'];

/** The form's starting values: the company's, or empty for a new one. */
export function valuesOf(
  company: Company | undefined,
): FormValues<CompanyField> {
  return (field) => company?.[field] ?? '';
}

/** A new company from the form. */
export function createInput(values: FormValues<CompanyField>): CompanyCreate {
  const input: CompanyCreate = { name: '' };
  fillCreate(input, companyFields, values);
  return input;
}

/** Only what the form changed. */
export function patchOf(
  company: Company,
  values: FormValues<CompanyField>,
): CompanyPatch {
  const patch: CompanyPatch = {};
  fillPatch(patch, companyFields, valuesOf(company), values);
  return patch;
}
