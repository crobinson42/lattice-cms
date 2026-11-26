import { expect, it } from 'vitest';
import { companyOption } from './company-select.js';

it('keeps a hidden company’s id, labelled as hidden', () => {
  expect(companyOption({ id: 'c9' })).toEqual({
    id: 'c9',
    name: 'Hidden company',
  });
  const acme = {
    id: 'c1',
    organizationId: 'o1',
    name: 'Acme',
    createdAt: '2026-11-25T12:00:00.000Z',
    updatedAt: '2026-11-25T12:00:00.000Z',
  };
  expect(companyOption(acme)).toBe(acme);
});
