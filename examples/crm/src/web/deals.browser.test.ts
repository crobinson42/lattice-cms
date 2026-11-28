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

/** The API as Max, a manager in `organizationId`. */
function clientFor(crm: ReturnType<typeof createApp>, organizationId: string) {
  return createLocalClient(crm.app, {
    context: {
      actor: { userId: 'max', organizationId, role: 'manager' },
      logger: new NoopLogger(),
    },
  });
}

describe('deals in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  // The manager's own client, to change a deal behind the page's back.
  let max: ReturnType<typeof clientFor>;
  const ids = { rockets: '', bolt: '', fuel: '', order: '', ana: '', ben: '' };

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
    max = clientFor(crm, orgA.id);
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
    const order = await max.deals.create({
      title: 'Bolt order',
      companyId: bolt.id,
      amount: 900,
    });
    ids.order = order.id;
    const ana = await max.contacts.create({
      name: 'Ana Diaz',
      email: 'ana@rockets.test',
      companyId: rockets.id,
    });
    const ben = await max.contacts.create({
      name: 'Ben Brook',
      email: 'ben@bolt.test',
      companyId: bolt.id,
    });
    ids.ana = ana.id;
    ids.ben = ben.id;
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
    const page = await signedIn('max', '/deals?view=table');
    await page.getByRole('heading', { name: 'Deals', level: 1 }).waitFor();
    await page.getByText('3 deals').waitFor();
    // Title, Company, Stage, Amount, Owner, Expected close.
    expect(await column(page, 'Deals', 4)).toContain('$5,000');
    expect(await sortOptions(page)).toContain('Largest amount');

    await page.getByLabel('Stage').selectOption({ label: 'Proposal' });
    await page.waitForURL(/\?view=table&stage=proposal$/);
    await page.getByText('1 deal', { exact: true }).waitFor();
    expect(await column(page, 'Deals', 1)).toEqual(['Rocket fuel']);
    // The owner's cell is their avatar's initials, then their name.
    expect(await column(page, 'Deals', 5)).toEqual([
      expect.stringContaining('Max Mann'),
    ]);

    await page.getByLabel('Stage').selectOption({ label: 'Any stage' });
    await page.getByLabel('Sort by').selectOption({ label: 'Largest amount' });
    await page.waitForURL(/\?view=table&sort=-amount$/);
    await expect
      .poll(() => column(page, 'Deals', 1))
      .toEqual(['Rocket fuel', 'Bolt order', 'Old engine']);
  });

  it('withholds amounts from a member, and offers no amount sort', async () => {
    const page = await signedIn('mia', '/deals?view=table&sort=-amount');
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
    // The board opens, read fresh: once the Qualified column has its rows,
    // the archived deal is not among them, with no stale moment.
    const qualified = page.getByRole('list', { name: 'Qualified' });
    await qualified.getByRole('listitem').first().waitFor();
    expect(await qualified.textContent()).not.toContain('Old engine');
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

  /** What a `set` request sent: its input, the deal's id and its whole new list. */
  const sentSet = async (
    page: Page,
    change: () => Promise<void>,
  ): Promise<unknown> => {
    const sent = page.waitForRequest((request) =>
      request.url().includes('contacts/set'),
    );
    await change();
    return JSON.parse((await sent).postData() ?? 'null');
  };

  it('adds contacts to a deal with roles, sending the full list each time', async () => {
    const page = await signedIn('max', `/deals/${ids.order}`);
    const section = page.getByRole('region', { name: 'Contacts' });
    await section.getByText('No contacts on this deal').waitFor();

    await section.getByRole('button', { name: 'Add contact' }).click();
    const contact = page.getByRole('combobox', { name: 'Contact' });
    // With nothing typed, the deal's company's contacts come first.
    await contact.click();
    await page.getByRole('option', { name: 'Ben Brook' }).waitFor();
    await contact.press('ArrowDown');
    await contact.press('Enter');
    await page
      .getByLabel('Role', { exact: true })
      .selectOption({ label: 'Champion' });
    expect(
      await sentSet(page, () =>
        page.getByRole('button', { name: 'Add contact' }).last().click(),
      ),
    ).toEqual({
      input: {
        id: ids.order,
        links: [{ contactsId: ids.ben, role: 'champion' }],
      },
    });
    await section.getByRole('link', { name: 'Ben Brook' }).waitFor();

    // Another, from another company, found by name. Ben, on the deal
    // already, is not offered.
    await section.getByRole('button', { name: 'Add contact' }).click();
    await contact.click();
    await page
      .getByRole('status')
      .filter({ hasText: /No contacts found|contact/ })
      .first()
      .waitFor({ state: 'attached' });
    expect(await page.getByRole('option', { name: 'Ben Brook' }).count()).toBe(
      0,
    );
    await contact.fill('ana');
    await page.getByRole('option', { name: 'Ana Diaz' }).waitFor();
    await contact.press('ArrowDown');
    await contact.press('Enter');
    await page
      .getByLabel('Role', { exact: true })
      .selectOption({ label: 'Decision maker' });
    expect(
      await sentSet(page, () =>
        page.getByRole('button', { name: 'Add contact' }).last().click(),
      ),
    ).toEqual({
      input: {
        id: ids.order,
        links: [
          { contactsId: ids.ben, role: 'champion' },
          { contactsId: ids.ana, role: 'decision_maker' },
        ],
      },
    });
    await section.getByRole('link', { name: 'Ana Diaz' }).waitFor();
    await section.getByRole('link', { name: 'Acme Rockets' }).waitFor();
  });

  it('changes roles quickly, and removes a contact, sending the full list each time', async () => {
    const page = await signedIn('max', `/deals/${ids.order}`);
    const section = page.getByRole('region', { name: 'Contacts' });
    const ben = section.getByLabel('Role of Ben Brook');
    const ana = section.getByLabel('Role of Ana Diaz');
    await ana.waitFor();
    // Two changes, one right after the other: the second waits for the
    // first, and both survive.
    await ben.selectOption({ label: 'Other' });
    await ana.selectOption({ label: 'Champion' });
    expect(await ben.inputValue()).toBe('other');
    await expect.poll(() => ana.isEnabled()).toBe(true);
    await page.reload();
    await ana.waitFor();
    expect(await ben.inputValue()).toBe('other');
    expect(await ana.inputValue()).toBe('champion');

    // Remove Ana: the list sent is Ben alone, and focus goes to Add contact.
    await section
      .getByRole('row', { name: /Ana Diaz/ })
      .getByRole('button', { name: 'Remove' })
      .click();
    expect(
      await sentSet(page, () =>
        page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Remove' })
          .click(),
      ),
    ).toEqual({
      input: { id: ids.order, links: [{ contactsId: ids.ben, role: 'other' }] },
    });
    await expect
      .poll(() => section.getByRole('link', { name: 'Ana Diaz' }).count())
      .toBe(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toBe('Add contact');
  });

  it('says a deal closed in another tab once, without a success', async () => {
    const page = await signedIn('max', `/deals/${ids.order}`);
    const section = page.getByRole('region', { name: 'Contacts' });
    await section.getByLabel('Role of Ben Brook').waitFor();
    // Closed behind the page's back.
    await max.deals.close({ id: ids.order, outcome: 'lost' });
    await section.getByRole('button', { name: 'Add contact' }).click();
    const contact = page.getByRole('combobox', { name: 'Contact' });
    await contact.fill('ana');
    await page.getByRole('option', { name: 'Ana Diaz' }).waitFor();
    await contact.press('ArrowDown');
    await contact.press('Enter');
    await page.getByRole('button', { name: 'Add contact' }).last().click();
    await page
      .getByText('Bolt order was closed or archived, perhaps in another tab.')
      .waitFor();
    expect(await page.getByText(/^Added as/).count()).toBe(0);
    // The page reads the deal again: closed, its contacts read-only.
    await page.getByText('Closed deals can’t be edited.').waitFor();
  });
});
