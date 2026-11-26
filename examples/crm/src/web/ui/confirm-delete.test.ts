import { expect, it } from 'vitest';
import { deleteRefusal } from './confirm-delete.js';

it('says why a delete was refused', () => {
  expect(
    deleteRefusal('Acme', {
      code: 'REFERENCED',
      message: 'Other documents refer to this one',
      data: {
        collection: 'companies',
        id: 'c1',
        by: { collection: 'contacts', field: 'companyId' },
      },
    }),
  ).toBe('Acme still has contacts. Remove them first.');
  expect(
    deleteRefusal('Ana Diaz', {
      code: 'REFERENCED',
      message: 'Other documents refer to this one',
      data: {
        collection: 'contacts',
        id: 'k1',
        by: {
          collection: 'deal_contacts',
          field: 'contactsId',
          relation: { collection: 'deals', name: 'contacts' },
        },
      },
    }),
  ).toBe('Ana Diaz is still on deals. Remove Ana Diaz from them first.');
  expect(
    deleteRefusal('Acme', {
      code: 'FORBIDDEN',
      message: 'The actor may not do this',
    }),
  ).toBe('The actor may not do this');
});
