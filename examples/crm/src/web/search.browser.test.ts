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

// The search palette, in the built app in headless Chromium, against the
// real HTTP server on a port and MongoDB: opened by its shortcut and its
// button, results grouped by resource, the keyboard to a contact, focus
// back on close, a superseded search that never shows, and a create sheet
// from the empty palette.

const password = 'correct horse battery';

describe('search in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  const ids = { rosa: '' };

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
    const labs = await max.companies.create({ name: 'Rocket Labs' });
    await max.companies.create({ name: 'Zenith Foods' });
    const rosa = await max.contacts.create({
      name: 'Rosa Rojas',
      email: 'rosa@rocketlabs.test',
      companyId: labs.id,
    });
    ids.rosa = rosa.id;
    await max.deals.create({
      title: 'Rocket fuel',
      companyId: labs.id,
      amount: 1000,
      stage: 'proposal',
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

  async function signedIn(path: string, heading: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL(path, base).href);
    await page.getByLabel('Email').fill('max@crm.test');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The page's own heading: the sign-in page has one too.
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    return page;
  }

  const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });
  const searchBox = (page: Page) => palette(page).getByRole('combobox');
  const options = (page: Page, group: string) =>
    palette(page)
      .getByRole('group', { name: group })
      .getByRole('option')
      .allTextContents();

  it('opens on its shortcut, and groups what it finds by resource', async () => {
    const page = await signedIn('/companies', 'Companies');
    await page.keyboard.press('Control+k');
    await searchBox(page).waitFor();
    // Nothing typed: the app's sections and its create sheets.
    expect(await options(page, 'Go to')).toEqual([
      'Home',
      'Companies',
      'Contacts',
      'Deals',
      'Tasks',
      'Team',
    ]);
    await searchBox(page).fill('Ro');
    await palette(page).getByRole('group', { name: 'Deals' }).waitFor();
    expect(await options(page, 'Companies')).toEqual(['Rocket Labs']);
    expect(await options(page, 'Contacts')).toEqual(['Rosa RojasRocket Labs']);
    expect(await options(page, 'Deals')).toEqual([
      'Rocket fuelRocket Labs · Proposal',
    ]);
    await palette(page)
      .getByRole('status')
      .filter({ hasText: '3 results' })
      .waitFor({ state: 'attached' });

    await searchBox(page).fill('Nothing like it');
    await palette(page)
      .getByText('No results for “Nothing like it”')
      .first()
      .waitFor();
  });

  it('goes to a contact by the keyboard, and closes', async () => {
    const page = await signedIn('/companies', 'Companies');
    await page.keyboard.press('Control+k');
    await searchBox(page).fill('Ro');
    await palette(page).getByRole('group', { name: 'Contacts' }).waitFor();
    // The first result is selected: one down is the contact.
    await page.keyboard.press('ArrowDown');
    expect(
      await palette(page).getByRole('option', { selected: true }).textContent(),
    ).toBe('Rosa RojasRocket Labs');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Rosa Rojas', level: 1 }).waitFor();
    expect(new URL(page.url()).pathname).toBe(`/contacts/${ids.rosa}`);
    expect(await palette(page).count()).toBe(0);
  });

  it('opens from its button, and gives focus back on Esc', async () => {
    const page = await signedIn('/companies', 'Companies');
    const button = page.getByRole('button', { name: 'Search…' });
    await button.click();
    await searchBox(page).waitFor();
    expect(
      await searchBox(page).evaluate((box) => box === document.activeElement),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await palette(page).waitFor({ state: 'detached' });
    await expect
      .poll(() => button.evaluate((node) => node === document.activeElement))
      .toBe(true);
  });

  it('never shows a search the user has typed past', async () => {
    const page = await signedIn('/companies', 'Companies');
    // The search for "Rocket" takes two seconds; "Zenith" answers at once.
    await page.route(/\/rpc\/companies[./]find/, async (route) => {
      if (route.request().postData()?.includes('Rocket') === true) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await route.continue().catch(() => {});
    });
    await page.keyboard.press('Control+k');
    await searchBox(page).fill('Rocket');
    // Past the pause, so the slow search has gone out.
    await page.waitForTimeout(400);
    await searchBox(page).fill('Zenith');
    await palette(page).getByRole('option', { name: 'Zenith Foods' }).waitFor();
    // Long enough for the slow answer, had it not been dropped.
    await page.waitForTimeout(2200);
    expect(await options(page, 'Companies')).toEqual(['Zenith Foods']);
    expect(
      await palette(page).getByRole('group', { name: 'Deals' }).count(),
    ).toBe(0);
  }, 15_000);

  it('opens the deal sheet from "New deal" in the empty palette', async () => {
    const page = await signedIn('/', 'Home');
    await page.getByRole('button', { name: 'Search…' }).click();
    await palette(page).getByRole('option', { name: 'New deal' }).click();
    await page.getByRole('dialog', { name: 'New deal' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/deals');
    expect(new URL(page.url()).searchParams.get('new')).toBe('1');
    // Closing the sheet takes `new` off the URL.
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'New deal' }).waitFor({
      state: 'detached',
    });
    expect(new URL(page.url()).searchParams.get('new')).toBeNull();
  });
});
