import { expect, it } from 'vitest';
import { withContact, withoutContact } from './deal-contact-roles.js';

const links = [
  { contactsId: 'ana', role: 'champion' },
  { contactsId: 'ben', role: 'other' },
] as const;

it('adds a contact at the end, keeping the others', () => {
  expect(
    withContact(links, { contactsId: 'cara', role: 'decision_maker' }),
  ).toEqual([
    { contactsId: 'ana', role: 'champion' },
    { contactsId: 'ben', role: 'other' },
    { contactsId: 'cara', role: 'decision_maker' },
  ]);
});

it('changes the role of a contact already on the deal, in place', () => {
  expect(withContact(links, { contactsId: 'ben', role: 'champion' })).toEqual([
    { contactsId: 'ana', role: 'champion' },
    { contactsId: 'ben', role: 'champion' },
  ]);
});

it('removes a contact, keeping the others', () => {
  expect(withoutContact(links, 'ana')).toEqual([
    { contactsId: 'ben', role: 'other' },
  ]);
});
