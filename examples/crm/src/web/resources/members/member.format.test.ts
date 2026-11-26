import { expect, it } from 'vitest';
import { displayName, initials, roleLabels } from './member.format.js';

it('names a member, and takes up to two initials', () => {
  expect(displayName({ name: 'Ann Lee' })).toBe('Ann Lee');
  expect(initials({ name: 'Ann Lee' })).toBe('AL');
  expect(initials({ name: '  ben ' })).toBe('B');
  expect(initials({ name: 'Mary Ann de la Cruz' })).toBe('MA');
});

it('names each role', () => {
  expect(roleLabels.manager).toBe('Manager');
  expect(roleLabels.member).toBe('Member');
});
