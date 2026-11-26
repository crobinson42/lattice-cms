import { describe, expect, it } from 'vitest';
import {
  type CompanyField,
  createInput,
  patchOf,
  valuesOf,
} from './company-form.values.js';

const acme = {
  id: 'c1',
  organizationId: 'o1',
  name: 'Acme',
  domain: 'acme.test',
  industry: 'Retail ',
  createdAt: '2026-11-25T12:00:00.000Z',
  updatedAt: '2026-11-25T12:00:00.000Z',
};

/** The form's values, as a form holding `values` reads them. */
const form =
  (values: Partial<Record<CompanyField, string>>) => (field: CompanyField) =>
    values[field] ?? '';

describe('the company form', () => {
  it('starts empty for a new company, and from the company for an edit', () => {
    expect(valuesOf(undefined)('name')).toBe('');
    expect(valuesOf(acme)('domain')).toBe('acme.test');
    expect(valuesOf(acme)('phone')).toBe('');
  });

  it('creates with trimmed values, and leaves empty fields out', () => {
    expect(createInput(form({ name: ' Nimbus ', industry: ' Air ' }))).toEqual({
      name: 'Nimbus',
      industry: 'Air',
    });
  });

  it('sends only what changed, and null for a cleared field', () => {
    expect(patchOf(acme, valuesOf(acme))).toEqual({});
    expect(
      patchOf(
        acme,
        form({ name: 'Acme', industry: ' Logistics ', phone: '555' }),
      ),
    ).toEqual({ domain: null, industry: 'Logistics', phone: '555' });
    expect(patchOf(acme, form({ ...acme, name: '  ' }))).toEqual({ name: '' });
  });

  it('compares a stored value with spaces at its ends as the form trims it', () => {
    expect(patchOf(acme, form({ ...acme, industry: 'Retail' }))).toEqual({});
  });
});
