import { readdir } from 'node:fs/promises';
import { MemoryStore } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { httpSetup } from '../../test/http.js';
import { builtPage } from '../../test/web.js';
import { apiPaths } from './api-paths.js';

describe('the web page at /', () => {
  const { fetch } = httpSetup(new MemoryStore());
  const get = (path: string, method = 'GET') =>
    fetch(new Request(`http://localhost${path}`, { method }));

  it('serves index.html for every client route, never cached', async () => {
    for (const path of [
      '/',
      '/deals/123',
      '/admin',
      '/admin/',
      '/admin/deals',
      '/admin/deals/d1/edit',
      // A path that only starts like an API path is the page's.
      '/authors',
      '/rpcs/1',
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toContain('<div id="root">');
    }
    expect((await get('/deals/123', 'HEAD')).status).toBe(200);
  });

  it('serves a hashed asset with its type, cached for good', async () => {
    const assets = await readdir(new URL('assets/', builtPage));
    const script = assets.find((name) => name.endsWith('.js'));
    if (script === undefined) throw new Error('no built script');
    const response = await get(`/assets/${script}`);
    expect(response.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('answers 404 for a missing asset or a path out of assets', async () => {
    expect((await get('/assets/missing.js')).status).toBe(404);
    expect((await get('/assets/..%2Fpackage.json')).status).toBe(404);
    expect((await get('/assets/sub/dir.js')).status).toBe(404);
  });

  it('leaves every API path, and each path under one, to the API', async () => {
    for (const base of apiPaths) {
      for (const path of [base, `${base}/anything`]) {
        const response = await get(path);
        expect(
          response.headers.get('content-type') ?? '',
          `GET ${path}`,
        ).not.toContain('text/html');
      }
    }
    expect((await get('/health')).status).toBe(200);
    // Signed out, so refused: but by the API, not the page.
    const catalog = await get('/catalog.json');
    expect(catalog.status).toBe(401);
    expect(catalog.headers.get('content-type')).toContain('application/json');
    expect((await get('/mcp')).status).toBe(401);
  });

  it('serves only GET and HEAD', async () => {
    expect((await get('/deals/123', 'POST')).status).toBe(404);
  });
});
