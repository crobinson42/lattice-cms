import { MemoryLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { provisionDevUser } from '../infra/auth/dev-session.js';
import type { CrmSessions } from '../infra/auth/sessions.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { createApp } from '../servers/app.js';
import { storeLogin } from '../servers/auth/login.js';
import { organizationHeader } from '../servers/http/headers.js';
import { type Running, start } from '../servers/http/server.js';
import { testSessions } from '../test/sessions.js';
import { builtPage } from '../test/web.js';

// The built app, in headless Chromium, against the real HTTP server on a
// port and MongoDB: the sign-in redirect and its return, the shell, the
// organization switch, the admin through the user menu and back, sign-out,
// a session that ends on the server, support, and an admin chunk that
// fails to load.

const password = 'correct horse battery';

describe('the app in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  let sessions: CrmSessions;

  beforeAll(async () => {
    const store = new MongoStore({ url, database });
    sessions = testSessions();
    running = await start({
      store,
      events: new MemoryDomainEventPublisher(),
      sessions,
      support: new Set(['sam']),
      logger: new MemoryLogger(),
      port: 0,
      hostname: '127.0.0.1',
      web: builtPage,
    });
    base = running.url;
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const { credentials } = storeLogin(store);
    const deps = { crm, sessions: testSessions(), credentials };
    // A manager in two organizations, named Max Mann in both.
    for (const organization of ['Org A', 'Org B']) {
      await provisionDevUser(deps, {
        userId: 'max',
        name: 'Max Mann',
        email: 'max@crm.test',
        password,
        organization,
        role: 'manager',
      });
    }
    // Support: credentials, and no membership.
    await credentials.set({ userId: 'sam', email: 'sam@crm.test' }, password);
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw new Error(
        'Chromium for Playwright is not installed: run `npx playwright install chromium`.',
        { cause: error },
      );
    }
  });

  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    const client = new MongoClient(url);
    await client.db(database).dropDatabase();
    await client.close();
  });

  async function newPage(): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    return page;
  }

  const path = (page: Page) => {
    const { pathname, search } = new URL(page.url());
    return pathname + search;
  };

  async function signIn(page: Page, email: string) {
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  /** The focused element's tag and accessible label. */
  const focused = (page: Page) =>
    page.evaluate(() => {
      const element = document.activeElement;
      return `${element?.tagName} ${element?.getAttribute('aria-label') ?? element?.textContent}`;
    });

  it('signs in, switches organization, opens the admin and comes back, and signs out', async () => {
    const page = await newPage();

    // A page needs a session: it sends the user to sign in, and back after,
    // with focus on the page's heading.
    await page.goto(new URL('/companies', base).href);
    await signIn(page, 'max@crm.test');
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    expect(path(page)).toBe('/companies');
    expect(await focused(page)).toBe('H1 Companies');
    expect(
      await page
        .locator('[data-slot="sidebar"]')
        .getByRole('link', { name: 'Companies' })
        .getAttribute('href'),
    ).toBe('/companies');

    // The switcher lists both organizations. A switch reloads the page's
    // data in the new organization, and keeps focus on the switcher.
    const switcher = page.getByLabel('Organization');
    expect(await switcher.locator('option').allTextContents()).toEqual([
      'Org A',
      'Org B',
    ]);
    const orgB = await switcher
      .locator('option', { hasText: 'Org B' })
      .getAttribute('value');
    const inOrgB = page.waitForRequest(
      (request) =>
        request.url().includes('/rpc') &&
        request.headers()[organizationHeader] === orgB,
    );
    await switcher.selectOption({ label: 'Org B' });
    await inOrgB;
    expect(await switcher.locator('option:checked').textContent()).toBe(
      'Org B',
    );
    expect(path(page)).toBe('/companies');
    await expect.poll(() => focused(page)).toBe('SELECT Organization');

    // The user menu names the member, and links to the admin.
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByText('Max Mann').waitFor();
    const admin = page.getByRole('menuitem', { name: 'Admin' });
    expect(await admin.getAttribute('href')).toBe('/admin');
    await admin.click();
    await page.getByRole('heading', { name: 'Collections' }).waitFor();
    expect(path(page)).toBe('/admin');
    // The admin works in the organization the app picked.
    expect(
      await page
        .getByLabel('Organization')
        .locator('option:checked')
        .textContent(),
    ).toBe('Org B');

    // Back to the app, then sign out from the user menu.
    await page.getByRole('link', { name: 'Back to CRM' }).click();
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    expect(path(page)).toBe('/sign-in?next=%2Fcompanies');
  });

  it('returns to the page that sent it to sign in, and signs out on a 401', async () => {
    const page = await newPage();
    await page.goto(new URL('/admin/companies?limit=5', base).href);
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    expect(path(page)).toBe('/sign-in?next=%2Fadmin%2Fcompanies%3Flimit%3D5');
    await signIn(page, 'max@crm.test');
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    expect(path(page)).toBe('/admin/companies?limit=5');

    // Signed in, the sign-in page sends the user on.
    await page.goto(new URL('/sign-in', base).href);
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    expect(path(page)).toBe('/companies');

    // The session ends on the server: the next call's 401 signs out.
    const token = await page.evaluate(() =>
      sessionStorage.getItem('crm.token'),
    );
    await sessions.close(token ?? undefined);
    await page.reload();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    expect(path(page)).toBe('/sign-in?next=%2Fcompanies');
    expect(
      await page.evaluate(() => sessionStorage.getItem('crm.token')),
    ).toBeNull();
  });

  it('sends support, which has no organization, to the admin', async () => {
    const page = await newPage();
    await page.goto(base.href);
    await signIn(page, 'sam@crm.test');
    await page.getByRole('heading', { name: 'Collections' }).waitFor();
    expect(path(page)).toBe('/admin');
    expect(await page.getByLabel('Organization').count()).toBe(0);
    expect(await page.getByRole('link', { name: 'Back to CRM' }).count()).toBe(
      0,
    );
  });

  it('offers a reload when the admin fails to load', async () => {
    const page = await newPage();
    // As after a deploy, when the page asks for a chunk that is gone.
    await page.route('**/assets/admin-page-*', (route) => route.abort());
    await page.goto(new URL('/admin', base).href);
    await signIn(page, 'max@crm.test');
    await page.getByText('The admin could not be loaded.').waitFor();
    await page.unroute('**/assets/admin-page-*');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Collections' }).waitFor();
  });
});
