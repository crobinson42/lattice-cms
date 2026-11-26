import type { FormValues } from '../../ui/form.js';
import type { Company, CompanyCreate, CompanyPatch } from './company.js';

/** The form's fields, in its order. */
export const companyFields = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'domain', label: 'Domain', type: 'text' },
  { name: 'industry', label: 'Industry', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel' },
] as const;

export type CompanyField = (typeof companyFields)[number]['name'];

const optional = ['domain', 'industry', 'phone'] as const;

/** The form's starting values: the company's, or empty for a new one. */
export function valuesOf(
  company: Company | undefined,
): FormValues<CompanyField> {
  return (field) => company?.[field] ?? '';
}

/** A new company from the form: trimmed, with empty fields left out. */
export function createInput(values: FormValues<CompanyField>): CompanyCreate {
  const input: CompanyCreate = { name: values('name').trim() };
  for (const field of optional) {
    const value = values(field).trim();
    if (value !== '') input[field] = value;
  }
  return input;
}

/**
 * Only what the form changed, both sides trimmed. A cleared optional field
 * is `null`, which removes it. The server validates the rest: an emptied
 * name is sent, and refused at its field.
 */
export function patchOf(
  company: Company,
  values: FormValues<CompanyField>,
): CompanyPatch {
  const before = valuesOf(company);
  const patch: CompanyPatch = {};
  const name = values('name').trim();
  if (name !== before('name').trim()) patch.name = name;
  for (const field of optional) {
    const value = values(field).trim();
    if (value !== before(field).trim()) {
      patch[field] = value === '' ? null : value;
    }
  }
  return patch;
}
