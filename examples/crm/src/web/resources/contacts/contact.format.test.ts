import { expect, it } from 'vitest';
import { contactCount } from './contact.format.js';

it('counts contacts', () => {
  expect(contactCount(0)).toBe('0 contacts');
  expect(contactCount(1)).toBe('1 contact');
  expect(contactCount(7)).toBe('7 contacts');
});
