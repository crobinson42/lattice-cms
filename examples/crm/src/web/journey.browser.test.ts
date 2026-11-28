import { MemoryLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { demoPassword, seedDemo } from '../infra/seed/demo.js';
import { createApp } from '../servers/app.js';
import { storeLogin } from '../servers/auth/login.js';
import { type Running, start } from '../servers/http/server.js';
import { testSessions } from '../test/sessions.js';
import { builtPage } from '../test/web.js';

// What the README promises, from the real seed, as Ann: one story in the
// built app in headless Chromium, against the HTTP server on a port and
// MongoDB. Each step is a test, in order, on the same page, so a failure
// names the step it broke at.

describe('a day in the crm, as Ann', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let page: Page;
  // Won this month on Home, before Ann closes a deal.
  let wonBefore = 0;

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
    // As `npm run seed` does.
    await seedDemo({
      crm: createApp({ store, events: new MemoryDomainEventPublisher() }),
      credentials: storeLogin(store).credentials,
      now: new Date(),
    });
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw new Error(
        'Chromium for Playwright is not installed: run `npx playwright install chromium`.',
        { cause: error },
      );
    }
    page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    const client = new MongoClient(url);
    await client.db(database).dropDatabase();
    await client.close();
  });

  const go = (to: string) =>
    page.locator('[data-sidebar="menu"]').getByRole('link', { name: to });
  const heading = (name: string) =>
    page.getByRole('heading', { name, level: 1 }).waitFor();
  const region = (name: string) =>
    page.getByRole('region', { name, exact: true });
  /** A pipeline tile's count on Home, by its label. */
  const tile = async (label: string) =>
    Number(
      await region('Pipeline')
        .getByRole('link')
        .filter({ hasText: label })
        .locator('span')
        .nth(1)
        .textContent(),
    );

  it('signs in, and Home shows her tasks, deals, pipeline and activity', async () => {
    await page.goto(new URL('/', running.url).href);
    await page.getByLabel('Email').fill('ann@example.com');
    await page.getByLabel('Password').fill(demoPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await heading('Home');
    await region('My tasks')
      .getByRole('checkbox', { name: 'Send the revised quote' })
      .waitFor();
    await page
      .getByRole('list', { name: 'My open deals' })
      .getByRole('link', { name: 'Patient portal' })
      .waitFor();
    await expect.poll(() => tile('Lead')).toBeGreaterThan(0);
    wonBefore = await tile('Won this month');
    await page
      .getByRole('list', { name: 'Recent activity' })
      .getByRole('article')
      .first()
      .waitFor();
  });

  it('opens a company, then one of its deals, and logs a call there', async () => {
    await go('Companies').click();
    await page.getByRole('link', { name: 'Pinecrest Health' }).click();
    await heading('Pinecrest Health');
    await region('Deals').getByRole('link', { name: 'Patient portal' }).click();
    await heading('Patient portal');
    await page
      .getByRole('button', { name: 'Log a note, call, email or meeting…' })
      .click();
    await page.getByLabel('Kind').selectOption({ label: 'Call' });
    await page
      .getByLabel('What happened')
      .fill('Walked through the rollout plan.');
    await page.getByRole('button', { name: 'Log activity' }).click();
    await page.getByText('Call logged').waitFor();
  });

  it('finds the call on the company’s timeline, linked to its deal', async () => {
    await region('Overview')
      .getByRole('link', { name: 'Pinecrest Health' })
      .click();
    await heading('Pinecrest Health');
    await region('Activity on Pinecrest Health')
      .getByRole('article')
      .filter({ hasText: 'Walked through the rollout plan.' })
      .getByRole('link', { name: 'Patient portal' })
      .waitFor();
  });

  it('moves a deal on the board by the keyboard', async () => {
    await go('Deals').click();
    await page
      .getByRole('button', { name: 'Actions for Line sensors' })
      .focus();
    await page.keyboard.press('Enter');
    // The menu lists the other stages in the pipeline's order: Lead, then
    // Proposal, for a qualified deal.
    await page.getByRole('menuitem', { name: 'Lead' }).waitFor();
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toBe('Proposal');
    await page.keyboard.press('Enter');
    await page
      .getByRole('status')
      .filter({ hasText: 'Moved Line sensors to Proposal' })
      .waitFor({ state: 'attached' });
    await page
      .getByRole('list', { name: 'Proposal' })
      .getByRole('link', { name: 'Line sensors' })
      .waitFor();
  });

  it('closes a deal as won, and Won this month goes up on Home', async () => {
    await page
      .getByRole('button', { name: 'Actions for Patient portal' })
      .click();
    await page.getByRole('menuitem', { name: 'Close as won…' }).click();
    await page
      .getByRole('alertdialog', { name: 'Close Patient portal as won?' })
      .getByRole('button', { name: 'Close as won' })
      .click();
    await page.getByText('Closed Patient portal as won').waitFor();
    await go('Home').click();
    await heading('Home');
    await expect.poll(() => tile('Won this month')).toBe(wonBefore + 1);
  });

  it('adds a task from a contact’s section', async () => {
    await go('Contacts').click();
    await page.getByRole('link', { name: 'Maya Chen' }).click();
    await heading('Maya Chen');
    const add = page.getByRole('form', { name: 'Add a task' });
    await add.getByLabel('New task').fill('Send the pilot summary');
    await add.getByRole('button', { name: 'Add' }).click();
    await page.getByText('Added Send the pilot summary').waitFor();
    await region('Tasks on Maya Chen')
      .getByRole('checkbox', { name: 'Send the pilot summary' })
      .waitFor();
  });

  it('completes it from the Tasks page', async () => {
    await go('Tasks').click();
    const open = region('Open tasks');
    await open
      .getByRole('checkbox', { name: 'Send the pilot summary' })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Marked Send the pilot summary done' })
      .waitFor({ state: 'attached' });
    await open
      .getByRole('checkbox', { name: 'Send the pilot summary' })
      .waitFor({ state: 'detached' });
  });

  it('switches to Globex, and sees only its companies', async () => {
    await page.getByLabel('Organization').selectOption({ label: 'Globex' });
    await go('Companies').click();
    const table = page.getByRole('table', { name: 'Companies' });
    await table.getByRole('link', { name: 'Hightower Media' }).waitFor();
    expect(
      // Each company's own link: the table links its website too.
      (
        await table.locator('a[href^="/companies/"]').allTextContents()
      ).toSorted(),
    ).toEqual(['Hightower Media', 'Orbit Aerospace', 'Seaside Hotels']);
  });

  it('searches with ⌘K for a contact, and opens them', async () => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search' });
    await palette.getByRole('combobox').fill('Ruth');
    await palette.getByRole('option', { name: /^Ruth Adler/ }).waitFor();
    await page.keyboard.press('Enter');
    await heading('Ruth Adler');
  });

  it('opens the admin, and comes back', async () => {
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Admin' }).click();
    await page.getByRole('heading', { name: 'Collections' }).waitFor();
    await page.getByRole('link', { name: 'Back to CRM' }).click();
    await heading('Home');
  });
});
