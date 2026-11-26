import { expect, it } from 'vitest';
import { parentsOf, whereOn } from './parents.js';

it('records the company with a deal or a contact, and alone on a company', () => {
  expect(parentsOf({ on: 'deal', id: 'd1', companyId: 'c1' })).toEqual({
    dealId: 'd1',
    companyId: 'c1',
  });
  expect(parentsOf({ on: 'contact', id: 'k1', companyId: 'c1' })).toEqual({
    contactId: 'k1',
    companyId: 'c1',
  });
  expect(parentsOf({ on: 'company', id: 'c1' })).toEqual({ companyId: 'c1' });
});

it('filters a record’s activities or tasks on its own parent', () => {
  expect(whereOn({ on: 'company', id: 'c1' })).toEqual({
    companyId: { eq: 'c1' },
  });
  expect(whereOn({ on: 'contact', id: 'k1', companyId: 'c1' })).toEqual({
    contactId: { eq: 'k1' },
  });
  expect(whereOn({ on: 'deal', id: 'd1', companyId: 'c1' })).toEqual({
    dealId: { eq: 'd1' },
  });
});
