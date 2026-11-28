import { describe, expect, it } from 'vitest';
import {
  type ContactField,
  createInput,
  patchOf,
  valuesOf,
} from './contact-form.values.js';

const acme = {
  id: 'c1',
  organizationId: 'o1',
  name: 'Acme',
  createdAt: '2026-11-25T12:00:00.000Z',
  updatedAt: '2026-11-25T12:00:00.000Z',
};
const ana = {
  id: 'k1',
  organizationId: 'o1',
  name: 'Ana Diaz',
  email: 'ana@acme.test',
  title: 'CTO',
  companyId: acme,
  createdAt: '2026-11-25T12:00:00.000Z',
  updatedAt: '2026-11-25T12:00:00.000Z',
};

/** The form's values, as a form holding `values` reads them. */
const form =
  (values: Partial<Record<ContactField, string>>) => (field: ContactField) =>
    values[field] ?? '';

describe('the contact form', () => {
  it("starts from the contact, with its company's id", () => {
    expect(valuesOf(ana)('companyId')).toBe('c1');
    expect(valuesOf(ana)('phone')).toBe('');
    expect(valuesOf(undefined)('name')).toBe('');
    expect(valuesOf({ ...ana, companyId: { id: 'c9' } })('companyId')).toBe(
      'c9',
    );
  });

  it('creates with trimmed values, and leaves empty optional fields out', () => {
    expect(
      createInput(
        form({ name: ' Ana ', email: 'ana@acme.test ', companyId: 'c1' }),
      ),
    ).toEqual({ name: 'Ana', email: 'ana@acme.test', companyId: 'c1' });
  });

  it('sends nothing for a hidden company the form did not change', () => {
    const hidden = { ...ana, companyId: { id: 'c9' } };
    // The select submits the hidden company's id until another is picked.
    expect(
      patchOf(hidden, form({ ...ana, name: 'Ana D', companyId: 'c9' })),
    ).toEqual({ name: 'Ana D' });
  });

  it('sends only what changed, and null for a cleared field', () => {
    expect(patchOf(ana, valuesOf(ana))).toEqual({});
    expect(
      patchOf(
        ana,
        form({
          name: 'Ana Diaz',
          email: 'ana@acme.test',
          companyId: 'c2',
          phone: '555',
        }),
      ),
    ).toEqual({ companyId: 'c2', title: null, phone: '555' });
  });
});
