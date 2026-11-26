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

// Deals end to end, in the built app in headless Chromium, against the real
// HTTP server on a port and MongoDB, as a manager, who reads amounts, and a
// member, who does not: the list's filter and sorts, a blind amount on
// create, an owner, an edit without the amount, closing once, archiving,
// and a company's own deals.

const password = 'correct horse battery';

describe('deals in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  const ids = { rockets: '', bolt: '', fuel: '' };

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
    await provisionDevUser(deps, {
      userId: 'max',
      name: 'Max Mann',
      email: 'max@crm.test',
      password,
      organization: 'Org A',
      role: 'manager',
    });
    await provisionDevUser(deps, {
      userId: 'mia',
      name: 'Mia Moss',
      email: 'mia@crm.test',
      password,
      organization: 'Org A',
      role: 'member',
    });
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
    ids.rockets = rockets.id;
    ids.bolt = bolt.id;
    const fuel = await max.deals.create({
      title: 'Rocket fuel',
      companyId: rockets.id,
      amount: 5000,
      stage: 'proposal',
      ownerId: 'max',
      expectedCloseDate: '2026-12-01',
    });
    ids.fuel = fuel.id;
    await max.deals.create({
      title: 'Bolt order',
      companyId: bolt.id,
      amount: 900,
    });
    await max.deals.create({
      title: 'Old engine',
      companyId: rockets.id,
      amount: 300,
      stage: 'qualified',
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

  async function signedIn(who: 'max' | 'mia', path: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL(path, base).href);
    await page.getByLabel('Email').fill(`${who}@crm.test`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    return page;
  }

  const column = (page: Page, table: string, index: number) =>
    page
      .getByRole('table', { name: table })
      .locator(`tbody tr td:nth-child(${index})`)
      .allTextContents();

  const sortOptions = (page: Page) =>
    page.getByLabel('Sort by').locator('option').allTextContents();

  it('shows a manager amounts, and filters and sorts by them', async () => {
    const page = await signedIn('max', '/deals');
    await page.getByRole('heading', { name: 'Deals', level: 1 }).waitFor();
    await page.getByText('3 deals').waitFor();
    // Title, Company, Stage, Amount, Owner, Expected close.
    expect(await column(page, 'Deals', 4)).toContain('$5,000');
    expect(await sortOptions(page)).toContain('Largest amount');

    await page.getByLabel('Stage').selectOption({ label: 'Proposal' });
    await page.waitForURL(/\?stage=proposal$/);
    await page.getByText('1 deal', { exact: true }).waitFor();
    expect(await column(page, 'Deals', 1)).toEqual(['Rocket fuel']);
    // The owner's cell is their avatar's initials, then their name.
    expect(await column(page, 'Deals', 5)).toEqual([
      expect.stringContaining('Max Mann'),
    ]);

    await page.getByLabel('Stage').selectOption({ label: 'Any stage' });
    await page.getByLabel('Sort by').selectOption({ label: 'Largest amount' });
    await page.waitForURL(/\?sort=-amount$/);
    await expect
      .poll(() => column(page, 'Deals', 1))
      .toEqual(['Rocket fuel', 'Bolt order', 'Old engine']);
  });

  it('withholds amounts from a member, and offers no amount sort', async () => {
    const page = await signedIn('mia', '/deals?sort=-amount');
    await page.getByText('3 deals').waitFor();
    expect(await column(page, 'Deals', 4)).toEqual([
      'Withheld',
      'Withheld',
      'Withheld',
    ]);
    expect(await sortOptions(page)).not.toContain('Largest amount');
    // An amount sort in the URL falls back to the list's own.
    expect(await page.getByLabel('Sort by').inputValue()).toBe('-createdAt');
  });

  it('lets a member create a deal blind, assign an owner, and edit without the amount', async () => {
    const page = await signedIn('mia', '/deals');
    await page.getByRole('button', { name: 'New deal' }).click();
    await page
      .getByText('Only managers see amounts: you will not see it after saving.')
      .waitFor();
    await page.getByLabel('Title').fill('Bolt spares');
    const company = page.getByRole('combobox', { name: 'Company' });
    await company.fill('bolt');
    await page.getByRole('option', { name: 'Bolt Works' }).waitFor();
    await company.press('ArrowDown');
    await company.press('Enter');
    await page.getByLabel('Amount').fill('700');
    await page.getByLabel('Owner').selectOption({ label: 'Max Mann' });
    await page.getByRole('button', { name: 'Create deal' }).click();
    await page.getByText('Created Bolt spares').waitFor();
    await page
      .getByRole('heading', { name: 'Bolt spares', level: 1 })
      .waitFor();
    const overview = page.getByRole('region', { name: 'Overview' });
    await overview.getByText('Withheld').waitFor();
    await overview.getByText('Max Mann').waitFor();

    await page.getByRole('button', { name: 'Edit' }).click();
    expect(await page.getByLabel('Amount').count()).toBe(0);
    await page.getByLabel('Stage').selectOption({ label: 'Qualified' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Saved Bolt spares').waitFor();
    // The stage shows once, under the title.
    await page.getByRole('main').getByText('Qualified').waitFor();
  });

  it('closes a deal once, and says so when another tab closed it first', async () => {
    const first = await signedIn('max', `/deals/${ids.fuel}`);
    const second = await signedIn('max', `/deals/${ids.fuel}`);
    for (const page of [first, second]) {
      await page
        .getByRole('heading', { name: 'Rocket fuel', level: 1 })
        .waitFor();
    }
    await first.getByRole('button', { name: 'Won' }).click();
    await first
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Close as won' })
      .click();
    await first.getByText('Closed Rocket fuel as won').waitFor();
    await first.getByText('Closed deals can’t be edited.').waitFor();
    expect(await first.getByRole('button', { name: 'Edit' }).count()).toBe(0);

    // The second tab still shows the open deal.
    await second.getByRole('button', { name: 'Lost' }).click();
    await second
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Close as lost' })
      .click();
    await second
      .getByText('Rocket fuel was already closed, perhaps in another tab.')
      .waitFor();
    await second.getByText('Closed deals can’t be edited.').waitFor();
  });

  it('archives a deal, which leaves the list', async () => {
    const page = await signedIn('max', '/deals');
    await page.getByRole('link', { name: 'Old engine' }).click();
    await page.getByRole('heading', { name: 'Old engine', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Archive' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Archive' })
      .click();
    await page.getByText('Archived Old engine').waitFor();
    await page.getByRole('heading', { name: 'Deals', level: 1 }).waitFor();
    // The list reads again from nothing: once its rows are there, the
    // archived deal is not among them, with no stale moment to wait out.
    await page.getByRole('link', { name: 'Bolt order' }).waitFor();
    expect(await column(page, 'Deals', 1)).not.toContain('Old engine');
  });

  it("lists a company's deals, and adds one with the company picked", async () => {
    const page = await signedIn('max', `/companies/${ids.bolt}`);
    await page.getByRole('heading', { name: 'Bolt Works', level: 1 }).waitFor();
    const table = 'Deals at Bolt Works';
    await page.getByRole('table', { name: table }).waitFor();
    await page
      .getByRole('region', { name: 'Deals' })
      .getByRole('button', { name: 'New deal' })
      .click();
    expect(
      await page.getByRole('combobox', { name: 'Company' }).inputValue(),
    ).toBe('Bolt Works');
    await page.getByLabel('Title').fill('Bolt service');
    await page.getByLabel('Amount').fill('250');
    await page.getByRole('button', { name: 'Create deal' }).click();
    await page.getByText('Created Bolt service').waitFor();
    await expect.poll(() => column(page, table, 1)).toContain('Bolt service');
    expect(new URL(page.url()).pathname).toBe(`/companies/${ids.bolt}`);
  });
});
