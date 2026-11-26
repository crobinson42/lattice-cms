import { MemoryLogger, NoopLogger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
import { MongoStore } from '@latticecms/store-mongo';
import { createLocalClient } from '@ts-pf/server';
import { MongoClient } from 'mongodb';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { provisionDevUser } from '../infra/auth/dev-session.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { createApp } from '../servers/app.js';
import { storeLogin } from '../servers/auth/login.js';
import { type Running, start } from '../servers/http/server.js';
import { testSessions } from '../test/sessions.js';
import { builtPage } from '../test/web.js';

// Companies end to end, in the built app in headless Chromium, against the
// real HTTP server on a port and MongoDB: the list with its search, sort
// and pages, create, edit and delete, a refused delete, and the empty and
// not-found states.

const password = 'correct horse battery';

describe('companies in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;

  beforeAll(async () => {
    const store = new MongoStore({ url, database });
    running = await start({
      store,
      events: new MemoryDomainEventPublisher(),
      sessions: testSessions(),
      support: new Set(),
      logger: new MemoryLogger(),
      port: 0,
      hostname: '127.0.0.1',
      web: builtPage,
    });
    base = running.url;
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const { credentials } = storeLogin(store);
    const deps = { crm, sessions: testSessions(), credentials };
    // A manager in two organizations. Org B has no companies.
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
    const [orgA] = (
      await crm.repos.organizations.find(
        { where: { name: { eq: 'Org A' } }, limit: 1 },
        unscoped,
      )
    ).docs;
    if (orgA === undefined) throw new Error('Org A was not provisioned');
    const max = createLocalClient(crm.app, {
      context: {
        actor: { userId: 'max', organizationId: orgA.id, role: 'manager' },
        logger: new NoopLogger(),
      },
    });
    // 25 companies, more than a page: one with a contact, and 24 others.
    const rockets = await max.companies.create({ name: 'Acme Rockets' });
    await max.contacts.create({
      name: 'Rita Rocket',
      email: 'rita@rockets.test',
      companyId: rockets.id,
    });
    const bolts = [];
    for (let n = 1; n <= 24; n += 1) {
      bolts.push(
        await max.companies.create({
          name: `Bolt ${String(n).padStart(2, '0')}`,
        }),
      );
    }
    // The last one changed, so it leads when sorted by last updated.
    const [, , , , , , seventh] = bolts;
    if (seventh === undefined) throw new Error('Bolt 07 was not created');
    await max.companies.update({ id: seventh.id, industry: 'Hardware' });
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

  async function signedIn(): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/companies', base).href);
    await page.getByLabel('Email').fill('max@crm.test');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    return page;
  }

  const names = (page: Page) =>
    page.locator('tbody tr td:first-child').allTextContents();

  /** The focused element's text. */
  const focused = (page: Page) =>
    page.evaluate(() => document.activeElement?.textContent ?? '');

  it('lists, searches, sorts and pages through companies', async () => {
    const page = await signedIn();
    await page.getByText('25 companies').waitFor();
    await expect.poll(() => names(page)).toHaveLength(20);
    expect((await names(page))[0]).toBe('Acme Rockets');

    // The next page, then no more. Focus goes to the first new row.
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect.poll(() => names(page)).toHaveLength(25);
    await expect.poll(() => focused(page)).toBe('Bolt 20');
    expect(await page.getByRole('button', { name: 'Load more' }).count()).toBe(
      0,
    );

    // A search is in the URL, so a reload keeps it. A pause mid-typing
    // searches, and keeps what was typed, the space too.
    const box = page.getByLabel('Search companies');
    await box.fill('bolt ');
    await page.waitForURL(/\?q=bolt$/);
    await box.pressSequentially('1');
    await page.waitForURL(/\?q=bolt\+1$/);
    await page.getByText('10 companies').waitFor();
    await page.reload();
    await page.getByText('10 companies').waitFor();
    expect(await page.getByLabel('Search companies').inputValue()).toBe(
      'bolt 1',
    );
    expect(await names(page)).toEqual(
      Array.from({ length: 10 }, (_, n) => `Bolt ${10 + n}`),
    );

    // No match, and a way back.
    await page.getByLabel('Search companies').fill('zzz');
    await page.getByText('No companies match “zzz”').waitFor();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByText('25 companies').waitFor();
    expect(new URL(page.url()).search).toBe('');

    // Sorted by last updated, also in the URL.
    await page.getByLabel('Sort by').selectOption({ label: 'Last updated' });
    await page.waitForURL(/\?sort=-updatedAt$/);
    await expect.poll(async () => (await names(page))[0]).toBe('Bolt 07');
  });

  it('creates, edits and deletes a company', async () => {
    const page = await signedIn();

    // The server validates: an empty name is refused at its field.
    await page.getByRole('button', { name: 'New company' }).click();
    await page.getByRole('button', { name: 'Create company' }).click();
    const name = page.getByLabel('Name');
    await page.getByText('Enter a name').waitFor();
    expect(await name.getAttribute('aria-invalid')).toBe('true');
    await name.fill('Nimbus Air');
    await page.getByLabel('Domain').fill('nimbus.test');
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.getByText('Created Nimbus Air').waitFor();
    await page.getByRole('heading', { name: 'Nimbus Air', level: 1 }).waitFor();
    expect(new URL(page.url()).pathname).toMatch(/^\/companies\/[\w-]+$/);
    await expect.poll(() => focused(page)).toBe('Nimbus Air');
    // The top bar says where the page is, and links back up.
    const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
    expect(
      await breadcrumb
        .getByRole('link', { name: 'Companies' })
        .getAttribute('href'),
    ).toBe('/companies');
    await breadcrumb.getByText('Nimbus Air').waitFor();
    expect(
      await page
        .getByRole('link', { name: 'nimbus.test' })
        .getAttribute('href'),
    ).toBe('https://nimbus.test');

    // An edit sends only what changed.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Industry').fill('Aviation');
    const sent = page.waitForRequest((request) =>
      request.url().includes('update'),
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    const body = (await sent).postData() ?? '';
    expect(body).toContain('"industry":"Aviation"');
    expect(body).not.toContain('"name"');
    expect(body).not.toContain('"domain"');
    await page.getByText('Saved Nimbus Air').waitFor();
    await page
      .getByRole('region', { name: 'Overview' })
      .getByText('Aviation')
      .waitFor();

    // Delete, after a confirmation.
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByText('Deleted Nimbus Air').waitFor();
    await page.getByText('25 companies').waitFor();
    expect(new URL(page.url()).pathname).toBe('/companies');
    await expect.poll(() => focused(page)).toBe('Companies');
  });

  it('explains why a company with a contact cannot be deleted', async () => {
    const page = await signedIn();
    await page.getByRole('link', { name: 'Acme Rockets' }).click();
    await page
      .getByRole('heading', { name: 'Acme Rockets', level: 1 })
      .waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await dialog
      .getByText('Acme Rockets still has contacts. Remove them first.')
      .waitFor();
    expect(await dialog.getByRole('button', { name: 'Delete' }).count()).toBe(
      0,
    );
    await expect.poll(() => focused(page)).toBe('Close');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page
      .getByRole('heading', { name: 'Acme Rockets', level: 1 })
      .waitFor();
  });

  it('says when a company does not exist', async () => {
    const page = await signedIn();
    await page.goto(new URL('/companies/nope', base).href);
    await page.getByText('Company not found').waitFor();
    expect(
      await page
        .getByRole('link', { name: 'Back to companies' })
        .getAttribute('href'),
    ).toBe('/companies');
  });

  it('shows an organization with no companies how to add one', async () => {
    const page = await signedIn();
    await page.getByLabel('Organization').selectOption({ label: 'Org B' });
    await page.getByText('No companies yet').waitFor();
    await page.getByText('0 companies').waitFor();
    expect(
      await page.getByRole('button', { name: 'New company' }).count(),
    ).toBe(2);
  });

  // Last: it deletes one of the 25.
  it('refreshes every loaded page after a delete', async () => {
    const page = await signedIn();
    await page.getByText('25 companies').waitFor();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect.poll(() => names(page)).toHaveLength(25);
    await page.getByRole('link', { name: 'Bolt 22' }).click();
    await page.getByRole('heading', { name: 'Bolt 22', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByText('24 companies').waitFor();
    // Both loaded pages come back, read fresh: the second one without the
    // deleted company, and never with it.
    await expect.poll(() => names(page)).toHaveLength(24);
    expect(await names(page)).not.toContain('Bolt 22');
  });
});
