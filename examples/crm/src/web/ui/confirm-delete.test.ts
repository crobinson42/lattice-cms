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
        by: { collection: 'deal_contacts', field: 'contactsId' },
      },
    }),
  ).toBe('Acme still has deal contacts. Remove them first.');
  expect(
    deleteRefusal('Acme', {
      code: 'FORBIDDEN',
      message: 'The actor may not do this',
    }),
  ).toBe('The actor may not do this');
});
