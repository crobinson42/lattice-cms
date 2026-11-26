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

// Contacts end to end, in the built app in headless Chromium, against the
// real HTTP server on a port and MongoDB: the list with each contact's
// company, a company picked by keyboard, a refused field, edit, delete, a
// contact on a deal, and a company's own contacts.

const password = 'correct horse battery';

describe('contacts in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  const ids = { rockets: '', cobalt: '', eve: '' };

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
    await provisionDevUser(
      { crm, sessions: testSessions(), credentials },
      {
        userId: 'max',
        name: 'Max Mann',
        email: 'max@crm.test',
        password,
        organization: 'Org A',
        role: 'manager',
      },
    );
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
    const rockets = await max.companies.create({ name: 'Acme Rockets' });
    const bolt = await max.companies.create({ name: 'Bolt Works' });
    const cobalt = await max.companies.create({ name: 'Cobalt Labs' });
    ids.rockets = rockets.id;
    ids.cobalt = cobalt.id;
    const ana = await max.contacts.create({
      name: 'Ana Diaz',
      email: 'ana@rockets.test',
      title: 'CTO',
      companyId: rockets.id,
    });
    await max.contacts.create({
      name: 'Ben Brook',
      email: 'ben@bolt.test',
      companyId: bolt.id,
    });
    const eve = await max.contacts.create({
      name: 'Eve Ernst',
      email: 'eve@bolt.test',
      companyId: bolt.id,
    });
    ids.eve = eve.id;
    // Ana is on a deal, so she cannot be deleted.
    const deal = await max.deals.create({
      title: 'Rocket fuel',
      companyId: rockets.id,
      amount: 1000,
    });
    await max.deals.contacts.set({
      id: deal.id,
      links: [{ contactsId: ana.id, role: 'champion' }],
    });
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

  async function signedIn(path: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL(path, base).href);
    await page.getByLabel('Email').fill('max@crm.test');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    return page;
  }

  /** Picks a company in the open form's CompanySelect, by keyboard. */
  /**
   * Picks a company in the open form's CompanySelect, by keyboard, once the
   * search for what was typed has answered: the live region says so.
   */
  async function pickCompany(page: Page, typed: string, name: string) {
    const select = page.getByRole('combobox', { name: 'Company' });
    await select.fill(typed);
    // The live region is visually hidden: it is there, not visible.
    await page
      .getByRole('status')
      .filter({ hasText: '1 company' })
      .waitFor({ state: 'attached' });
    await page.getByRole('option', { name }).waitFor();
    await select.press('ArrowDown');
    await select.press('Enter');
    await expect.poll(() => select.inputValue()).toBe(name);
  }

  const names = (page: Page, table: string) =>
    page
      .getByRole('table', { name: table })
      .locator('tbody tr td:first-child')
      .allTextContents();

  it('lists and searches contacts, each with their company', async () => {
    const page = await signedIn('/contacts');
    await page.getByText('3 contacts').waitFor();
    expect(await names(page, 'Contacts')).toEqual([
      'Ana Diaz',
      'Ben Brook',
      'Eve Ernst',
    ]);
    expect(
      await page
        .getByRole('table', { name: 'Contacts' })
        .getByRole('link', { name: 'Acme Rockets' })
        .getAttribute('href'),
    ).toBe(`/companies/${ids.rockets}`);
    await page.getByLabel('Search contacts').fill('ana');
    await page.getByText('1 contact', { exact: true }).waitFor();
    expect(await names(page, 'Contacts')).toEqual(['Ana Diaz']);
  });

  it('creates a contact with a company picked by keyboard', async () => {
    const page = await signedIn('/contacts');
    await page.getByRole('button', { name: 'New contact' }).click();
    await page.getByLabel('Name').fill('Cara Cole');
    await page.getByLabel('Email').fill('not an address');
    // A newer search hides an older one's results: Bolt Works, found for
    // "bo", is gone while "co" is searched, so it cannot be picked.
    const select = page.getByRole('combobox', { name: 'Company' });
    await select.fill('bo');
    await page.getByRole('option', { name: 'Bolt Works' }).waitFor();
    await select.fill('co');
    expect(await page.getByRole('option', { name: 'Bolt Works' }).count()).toBe(
      0,
    );
    await page
      .getByRole('status')
      .filter({ hasText: 'Searching…' })
      .waitFor({ state: 'attached' });
    await page.getByRole('option', { name: 'Cobalt Labs' }).waitFor();
    // Esc closes the list and keeps the form.
    await select.press('Escape');
    await expect
      .poll(() => page.getByRole('option', { name: 'Cobalt Labs' }).count())
      .toBe(0);
    await pickCompany(page, 'bolt', 'Bolt Works');

    // The server refuses the address, at its field.
    await page.getByRole('button', { name: 'Create contact' }).click();
    await page
      .getByText('Enter an email address, like ana@example.com')
      .waitFor();
    expect(await page.getByLabel('Email').getAttribute('aria-invalid')).toBe(
      'true',
    );
    await page.getByLabel('Email').fill('cara@bolt.test');
    await page.getByRole('button', { name: 'Create contact' }).click();
    await page.getByText('Created Cara Cole').waitFor();
    await page.getByRole('heading', { name: 'Cara Cole', level: 1 }).waitFor();
    const overview = page.getByRole('region', { name: 'Overview' });
    await overview.getByRole('link', { name: 'Bolt Works' }).waitFor();
    const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
    expect(
      await breadcrumb
        .getByRole('link', { name: 'Contacts' })
        .getAttribute('href'),
    ).toBe('/contacts');
  });

  it("edits a contact's company, sending only that, and deletes them", async () => {
    const page = await signedIn(`/contacts/${ids.eve}`);
    await page.getByRole('heading', { name: 'Eve Ernst', level: 1 }).waitFor();
    const overview = page.getByRole('region', { name: 'Overview' });
    // The edit opens on the current company, and sends only the new one.
    await page.getByRole('button', { name: 'Edit' }).click();
    expect(
      await page.getByRole('combobox', { name: 'Company' }).inputValue(),
    ).toBe('Bolt Works');
    const sent = page.waitForRequest((request) =>
      request.url().includes('update'),
    );
    await pickCompany(page, 'cobalt', 'Cobalt Labs');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const body = (await sent).postData() ?? '';
    expect(body).toContain(`"companyId":"${ids.cobalt}"`);
    expect(body).not.toContain('"name"');
    expect(body).not.toContain('"email"');
    await page.getByText('Saved Eve Ernst').waitFor();
    await overview.getByRole('link', { name: 'Cobalt Labs' }).waitFor();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByText('Deleted Eve Ernst').waitFor();
    expect(new URL(page.url()).pathname).toBe('/contacts');
  });

  it('explains why a contact on a deal cannot be deleted', async () => {
    const page = await signedIn('/contacts');
    await page.getByRole('link', { name: 'Ana Diaz' }).click();
    await page.getByRole('heading', { name: 'Ana Diaz', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await dialog
      .getByText('Ana Diaz is still on deals. Remove Ana Diaz from them first.')
      .waitFor();
  });

  it("lists a company's contacts, and adds one with the company picked", async () => {
    const page = await signedIn(`/companies/${ids.rockets}`);
    await page
      .getByRole('heading', { name: 'Acme Rockets', level: 1 })
      .waitFor();
    const table = 'Contacts at Acme Rockets';
    await expect.poll(() => names(page, table)).toEqual(['Ana Diaz']);
    await page.getByRole('button', { name: 'New contact' }).click();
    expect(
      await page.getByRole('combobox', { name: 'Company' }).inputValue(),
    ).toBe('Acme Rockets');
    await page.getByLabel('Name').fill('Dan Dale');
    await page.getByLabel('Email').fill('dan@rockets.test');
    await page.getByRole('button', { name: 'Create contact' }).click();
    await page.getByText('Created Dan Dale').waitFor();
    await expect
      .poll(() => names(page, table))
      .toEqual(['Ana Diaz', 'Dan Dale']);
    expect(new URL(page.url()).pathname).toBe(`/companies/${ids.rockets}`);
  });

  it('shows a company with no contacts how to add one', async () => {
    const page = await signedIn(`/companies/${ids.cobalt}`);
    await page
      .getByRole('heading', { name: 'Cobalt Labs', level: 1 })
      .waitFor();
    await page
      .getByRole('region', { name: 'Contacts' })
      .getByText('No contacts yet')
      .waitFor();
  });
});
