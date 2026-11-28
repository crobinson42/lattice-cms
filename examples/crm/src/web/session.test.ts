import { describe, expect, it } from 'vitest';
import { nextPath } from './session.js';

describe('nextPath', () => {
  const origin = 'http://localhost:5173';

  it('keeps a page of this site, with its search and hash', () => {
    expect(nextPath('/companies', origin)).toBe('/companies');
    expect(nextPath('/admin/deals?stage=won#top', origin)).toBe(
      '/admin/deals?stage=won#top',
    );
  });

  it('sends anything else to /', () => {
    for (const next of [
      null,
      '//evil.com',
      '/\\evil.com',
      'https://evil.com/companies',
      'javascript:alert(1)',
      'http://localhost:5174/companies',
    ]) {
      expect(nextPath(next, origin), String(next)).toBe('/');
    }
  });
});
