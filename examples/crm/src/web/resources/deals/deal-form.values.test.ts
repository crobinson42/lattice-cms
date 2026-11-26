import { describe, expect, it } from 'vitest';
import {
  createInput,
  type DealField,
  dealFieldsFor,
  patchOf,
  valuesOf,
} from './deal-form.values.js';

const acme = {
  id: 'c1',
  organizationId: 'o1',
  name: 'Acme',
  createdAt: '2026-11-25T12:00:00.000Z',
  updatedAt: '2026-11-25T12:00:00.000Z',
};
const fuel = {
  id: 'd1',
  organizationId: 'o1',
  title: 'Rocket fuel',
  companyId: acme,
  amount: 1200,
  stage: 'proposal' as const,
  archived: false,
  ownerId: 'ann',
  expectedCloseDate: '2026-12-01',
  createdAt: '2026-11-25T12:00:00.000Z',
  updatedAt: '2026-11-25T12:00:00.000Z',
};

const form =
  (values: Partial<Record<DealField, string>>) => (field: DealField) =>
    values[field] ?? '';

describe('the deal form', () => {
  it('shows the amount to a manager, and to a member only on create', () => {
    const names = (readsAmounts: boolean, mode: 'create' | 'edit') =>
      dealFieldsFor(readsAmounts, mode).map(({ name }) => name);
    expect(names(true, 'edit')).toContain('amount');
    expect(names(false, 'create')).toContain('amount');
    expect(names(false, 'edit')).not.toContain('amount');
  });

  it('starts a new deal as a lead, and an edit from the deal', () => {
    expect(valuesOf(undefined)('stage')).toBe('lead');
    expect(valuesOf(fuel)('amount')).toBe('1200');
    expect(valuesOf(fuel)('companyId')).toBe('c1');
    expect(valuesOf({ ...fuel, amount: undefined })('amount')).toBe('');
  });

  it('creates with the amount as a number, and leaves an empty owner out', () => {
    expect(
      createInput(
        dealFieldsFor(false, 'create'),
        form({
          title: ' Fuel ',
          companyId: 'c1',
          amount: '1500',
          stage: 'lead',
          ownerId: '',
          expectedCloseDate: '2026-12-01',
        }),
      ),
    ).toEqual({
      title: 'Fuel',
      companyId: 'c1',
      amount: 1500,
      stage: 'lead',
      expectedCloseDate: '2026-12-01',
    });
  });

  it('patches what changed: a new owner, a cleared date, and no amount from a member', () => {
    expect(
      patchOf(
        { ...fuel, amount: undefined },
        dealFieldsFor(false, 'edit'),
        form({
          title: 'Rocket fuel',
          companyId: 'c1',
          stage: 'proposal',
          ownerId: 'ben',
          expectedCloseDate: '',
        }),
      ),
    ).toEqual({ ownerId: 'ben', expectedCloseDate: null });
  });
});
