import { MemoryLogger } from '@hexok/logger';
import { tenancy, unscoped } from '@latticecms/core';
import { MongoStore } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Companies } from '../domain/collections/companies.js';
import { Contacts } from '../domain/collections/contacts.js';
import { Deals } from '../domain/collections/deals.js';
import { provisionDevUser } from '../infra/auth/dev-session.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { createApp } from '../servers/app.js';
import { storeLogin } from '../servers/auth/login.js';
import { type Running, start } from '../servers/http/server.js';
import { testSessions } from '../test/sessions.js';
import { builtPage } from '../test/web.js';

// The built admin page, in headless Chromium, against the real HTTP server
// on a port and MongoDB: sign-in, the switcher, CRUD, masking, a REFERENCED
// delete, a relation's set, sign-out, and a reload on a deep link.

const password = 'correct horse battery';

/** Headless Chromium, or one line on how to install it. */
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    throw new Error(
      'Chromium for Playwright is not installed: run `npx playwright install chromium`.',
      { cause: error },
    );
  }
}

describe('the admin in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  let dealA = '';

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

    // A manager in two organizations, and a member in the first.
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const deps = {
      crm,
      sessions: testSessions(),
      credentials: storeLogin(store).credentials,
    };
    const max = { userId: 'max', email: 'max@crm.test', password };
    await provisionDevUser(deps, {
      ...max,
      organization: 'Org A',
      role: 'manager',
    });
    await provisionDevUser(deps, {
      ...max,
      organization: 'Org B',
      role: 'manager',
    });
    await provisionDevUser(deps, {
      userId: 'ann',
      email: 'ann@crm.test',
      password,
      organization: 'Org A',
    });
    const organizations = await crm.repos.organizations.find({}, unscoped);
    const idOf = (name: string) => {
      const found = organizations.docs.find((org) => org.name === name);
      if (found === undefined) throw new Error(`no ${name}`);
      return found.id;
    };

    // Each organization's own data. Acme A has a deal; Cara works elsewhere.
    const a = idOf('Org A');
    const acme = await crm.repos.companies.insert(
      { name: 'Acme A' },
      tenancy.scope(Companies, a),
    );
    const people = await crm.repos.companies.insert(
      { name: 'People Inc' },
      tenancy.scope(Companies, a),
    );
    await crm.repos.contacts.insert(
      { name: 'Cara', email: 'cara@people.test', companyId: people.id },
      tenancy.scope(Contacts, a),
    );
    dealA = (
      await crm.repos.deals.insert(
        { title: 'Deal A', companyId: acme.id, amount: 100 },
        tenancy.scope(Deals, a),
      )
    ).id;
    const b = idOf('Org B');
    const beta = await crm.repos.companies.insert(
      { name: 'Beta B' },
      tenancy.scope(Companies, b),
    );
    await crm.repos.deals.insert(
      { title: 'Deal B', companyId: beta.id, amount: 200 },
      tenancy.scope(Deals, b),
    );

    browser = await launch();
  });

  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    const client = new MongoClient(url);
    await client.db(database).dropDatabase();
    await client.close();
  });

  /** A fresh tab, signed in through the page's own form. */
  async function signIn(email: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/admin', base).href);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Collections' }).waitFor();
    return page;
  }

  async function openList(page: Page, label: string) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: label }).waitFor();
  }

  async function confirm(page: Page, action: string) {
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: action })
      .click();
  }

  it('signs in, and switches organizations', async () => {
    const page = await signIn('max@crm.test');
    await openList(page, 'Deals');
    await page.getByRole('link', { name: 'Deal A' }).waitFor();

    await page.getByLabel('Organization').selectOption({ label: 'Org B' });
    await page.getByRole('link', { name: 'Deal B' }).waitFor();
    expect(await page.getByRole('link', { name: 'Deal A' }).count()).toBe(0);
  });

  it('creates, edits and deletes a company and a deal', async () => {
    const page = await signIn('max@crm.test');
    await openList(page, 'Companies');
    await page.getByRole('link', { name: 'New company' }).click();
    await page.getByLabel('Name').fill('Initech');
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.getByRole('heading', { name: 'Initech' }).waitFor();
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('Initech Two');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('heading', { name: 'Initech Two' }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page.getByRole('heading', { name: 'Companies' }).waitFor();

    await page.getByRole('link', { name: 'Admin' }).click();
    await openList(page, 'Deals');
    await page.getByRole('link', { name: 'New deal' }).click();
    await page.getByLabel('Title').fill('Deal C');
    await page.getByLabel('Company id').fill('Acme');
    await page.getByRole('button', { name: 'Acme A' }).click();
    await page.getByLabel('Amount').fill('500');
    await page.getByRole('button', { name: 'Create deal' }).click();
    await page.getByRole('heading', { name: 'Deal C' }).waitFor();
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('Deal C2');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('heading', { name: 'Deal C2' }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page.getByRole('heading', { name: 'Deals' }).waitFor();
    await page.getByRole('link', { name: 'Deal A' }).waitFor();
    expect(await page.getByRole('link', { name: 'Deal C2' }).count()).toBe(0);
  });

  it('shows a member no amount, in the list or the form', async () => {
    const page = await signIn('ann@crm.test');
    await openList(page, 'Deals');
    await page.getByRole('link', { name: 'Deal A' }).waitFor();
    const headers = await page.getByRole('columnheader').allTextContents();
    expect(headers).toContain('Title');
    expect(headers).not.toContain('Amount');

    await page.getByRole('link', { name: 'Deal A' }).click();
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: 'Edit deal' }).waitFor();
    expect(await page.getByLabel('Title').inputValue()).toBe('Deal A');
    expect(await page.getByLabel('Amount').count()).toBe(0);
  });

  it('refuses to delete a company with deals, and links to them', async () => {
    const page = await signIn('max@crm.test');
    await openList(page, 'Companies');
    await page.getByRole('link', { name: 'Acme A' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page
      .getByRole('link', {
        name: 'Deals still refer to this company (Company id).',
      })
      .click();
    await page.getByRole('heading', { name: 'Deals' }).waitFor();
    await page.getByRole('link', { name: 'Deal A' }).waitFor();
    expect(new URL(page.url()).searchParams.get('filters')).toContain(
      'companyId',
    );
  });

  it('sets a deal’s contacts on its relation tab, and a linked contact cannot go', async () => {
    const page = await signIn('max@crm.test');
    await openList(page, 'Deals');
    await page.getByRole('link', { name: 'Deal A' }).click();
    await page.getByRole('link', { name: 'Contacts' }).click();
    await page.getByRole('button', { name: 'Edit links' }).click();
    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByLabel('Contact', { exact: true }).fill('Car');
    await page.getByRole('button', { name: 'Cara' }).click();
    await page.getByLabel('Role').selectOption('champion');
    await page.getByRole('button', { name: 'Save links' }).click();
    await confirm(page, 'Save links');
    await page.getByText('1 link', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Cara' }).click();

    // The refusal names the relation: its join collection is not in the
    // catalog.
    await page.getByRole('heading', { name: 'Cara' }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page
      .getByRole('link', { name: 'Deals still list this contact (Contacts).' })
      .click();
    await page.getByRole('heading', { name: 'Deals' }).waitFor();
    await page.getByRole('link', { name: 'Deal A' }).waitFor();
  });

  it('renders a deep link on reload, and signs out', async () => {
    const page = await signIn('max@crm.test');
    await page.goto(new URL(`/admin/deals/${dealA}`, base).href);
    await page.getByRole('heading', { name: 'Deal A' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Deal A' }).waitFor();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
  });
}, 120_000);
