import { expect, it } from 'vitest';
import { companyCount, websiteUrl } from './company.format.js';

it('counts companies', () => {
  expect(companyCount(0)).toBe('0 companies');
  expect(companyCount(1)).toBe('1 company');
  expect(companyCount(12)).toBe('12 companies');
});

it('opens a domain over https, and keeps a stored scheme', () => {
  expect(websiteUrl('acme.test')).toBe('https://acme.test');
  expect(websiteUrl('http://acme.test/about')).toBe('http://acme.test/about');
  expect(websiteUrl('javascript:alert(1)')).toBe('https://javascript:alert(1)');
});
