import { readdir } from 'node:fs/promises';
import { MemoryStore } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { httpSetup } from '../../test/http.js';
import { builtPage } from '../../test/web.js';

describe('the admin page at /admin', () => {
  const { fetch } = httpSetup(new MemoryStore());
  const get = (path: string) => fetch(new Request(`http://localhost${path}`));

  it('serves index.html for every admin route, never cached', async () => {
    for (const path of ['/admin', '/admin/', '/admin/deals/d1/edit']) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toContain('<div id="root">');
    }
  });

  it('serves a hashed asset with its type, cached for good', async () => {
    const assets = await readdir(new URL('assets/', builtPage));
    const script = assets.find((name) => name.endsWith('.js'));
    if (script === undefined) throw new Error('no built script');
    const response = await get(`/admin/assets/${script}`);
    expect(response.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('answers 404 for a missing asset or a path out of assets', async () => {
    expect((await get('/admin/assets/missing.js')).status).toBe(404);
    expect((await get('/admin/assets/..%2Fpackage.json')).status).toBe(404);
  });

  it('leaves the API and its documents alone', async () => {
    expect((await get('/health')).status).toBe(200);
    // Signed out, so refused: but by the API, not the page.
    const catalog = await get('/catalog.json');
    expect(catalog.status).toBe(401);
    expect(catalog.headers.get('content-type')).toContain('application/json');
    const rpc = await fetch(
      new Request('http://localhost/rpc/deals/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(rpc.headers.get('content-type')).toContain('application/json');
  });
});
