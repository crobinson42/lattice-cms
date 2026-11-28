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
import { isoDay } from './ui/format.js';

// The dashboard and the team page, in the built app in headless Chromium,
// against the real HTTP server on a port and MongoDB: the four sections as
// a manager and as a member, a task checked there, the pipeline after a
// move on the board, won this month against last month, one section's
// failed read beside the rest, and the team's rows.

const password = 'correct horse battery';

/** A plain date `offset` days from today, here: the browser's zone too. */
const day = (offset: number) => {
  const now = new Date();
  return isoDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
};

describe('the dashboard and the team in a browser', () => {
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
    for (const [userId, name, role] of [
      ['max', 'Max Mann', 'manager'],
      ['mia', 'Mia Moss', 'member'],
    ] as const) {
      await provisionDevUser(deps, {
        userId,
        name,
        email: `${userId}@crm.test`,
        password,
        organization: 'Org A',
        role,
      });
    }
    const [orgA] = (
      await crm.repos.organizations.find(
        { where: { name: { eq: 'Org A' } }, limit: 1 },
        unscoped,
      )
    ).docs;
    if (orgA === undefined) throw new Error('Org A was not provisioned');
    const client = (userId: string, role: 'manager' | 'member') =>
      createLocalClient(crm.app, {
        context: {
          actor: { userId, organizationId: orgA.id, role },
          logger: new NoopLogger(),
        },
      });
    const max = client('max', 'manager');
    const mia = client('mia', 'member');
    const rockets = await max.companies.create({ name: 'Acme Rockets' });
    const deal = (
      title: string,
      ownerId: string,
      stage: 'lead' | 'qualified' | 'proposal',
      expectedCloseDate?: string,
    ) =>
      max.deals.create({
        title,
        companyId: rockets.id,
        amount: 1000,
        stage,
        ownerId,
        ...(expectedCloseDate === undefined ? {} : { expectedCloseDate }),
      });
    const fuel = await deal('Rocket fuel', 'max', 'lead', day(-2));
    await deal('Launch pad', 'max', 'proposal');
    await deal('Mia’s pumps', 'mia', 'qualified', day(10));
    // Won and lost this month; won last month, which the month leaves out.
    const wonNow = await deal('Won now', 'max', 'lead');
    await max.deals.close({ id: wonNow.id, outcome: 'won' });
    const lostNow = await deal('Lost now', 'max', 'lead');
    await max.deals.close({ id: lostNow.id, outcome: 'lost' });
    const wonBefore = await deal('Won before', 'max', 'lead');
    await max.deals.close({ id: wonBefore.id, outcome: 'won' });
    const mongo = new MongoClient(url);
    await mongo
      .db(database)
      .collection<{ _id: string }>('deals')
      .updateOne(
        { _id: wonBefore.id },
        {
          $set: {
            closedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          },
        },
      );
    await mongo.close();

    const task = (title: string, due?: number) =>
      max.tasks.create({
        title,
        assigneeId: 'max',
        companyId: rockets.id,
        ...(due === undefined ? {} : { dueDate: day(due) }),
      });
    await task('Overdue call', -2);
    await task('Due today', 0);
    await task('Next week', 6);
    await task('Someday');
    await mia.activities.log({
      kind: 'call',
      body: 'Called about the fuel order.',
      occurredAt: new Date().toISOString(),
      dealId: fuel.id,
      companyId: rockets.id,
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

  async function signedIn(who: 'max' | 'mia', path = '/'): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL(path, base).href);
    await page.getByLabel('Email').fill(`${who}@crm.test`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    return page;
  }

  const section = (page: Page, name: string) =>
    page.getByRole('region', { name, exact: true });

  const taskTitles = (page: Page) =>
    page
      .getByRole('region', { name: 'My tasks due', exact: true })
      .getByRole('checkbox')
      .evaluateAll((boxes) =>
        boxes.map(
          (box) =>
            document.getElementById(box.getAttribute('aria-labelledby') ?? '')
              ?.textContent,
        ),
      );

  /** A pipeline tile's count, by its label. */
  const tile = (page: Page, label: string) =>
    section(page, 'Pipeline')
      .getByRole('link')
      .filter({ hasText: label })
      .locator('span')
      .nth(1)
      .textContent();

  it('shows a manager their tasks due, their deals, the pipeline and the latest activity', async () => {
    const page = await signedIn('max');
    await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
    // Due today or before, overdue first: not next week's, not the undated.
    await expect
      .poll(() => taskTitles(page), { timeout: 5_000 })
      .toEqual(['Overdue call', 'Due today']);
    expect(
      await section(page, 'My tasks')
        .getByRole('link', { name: 'View all tasks' })
        .getAttribute('href'),
    ).toBe('/tasks');

    // Mine and open, closing soonest first, the undated last.
    const deals = page.getByRole('list', { name: 'My open deals' });
    await deals.getByRole('article').first().waitFor();
    expect(
      await deals.getByRole('article').getByRole('link').allTextContents(),
    ).toEqual(['Rocket fuel', 'Acme Rockets', 'Launch pad', 'Acme Rockets']);
    const fuel = deals.getByRole('article').filter({ hasText: 'Rocket fuel' });
    await fuel.getByText('$1,000').waitFor();
    await fuel.getByText('· overdue').waitFor();

    await expect.poll(() => tile(page, 'Lead'), { timeout: 5_000 }).toBe('1');
    expect(await tile(page, 'Qualified')).toBe('1');
    expect(await tile(page, 'Proposal')).toBe('1');
    expect(await tile(page, 'Negotiation')).toBe('0');
    // Last month's win is not this month's.
    expect(await tile(page, 'Won this month')).toBe('1');
    expect(await tile(page, 'Lost this month')).toBe('1');
    expect(
      await section(page, 'Pipeline')
        .getByRole('link')
        .filter({ hasText: 'Won this month' })
        .getAttribute('href'),
    ).toBe('/deals?view=table&stage=won');

    const call = page
      .getByRole('list', { name: 'Recent activity' })
      .getByRole('article')
      .filter({ hasText: 'Called about the fuel order.' });
    await call.getByRole('link', { name: 'Rocket fuel' }).waitFor();
    await call.getByRole('link', { name: 'Acme Rockets' }).waitFor();
  });

  it('shows a member their own deals, with the amounts withheld', async () => {
    const page = await signedIn('mia');
    const deals = page.getByRole('list', { name: 'My open deals' });
    const pumps = deals.getByRole('article').filter({ hasText: 'Mia’s pumps' });
    await pumps.getByText('Withheld').waitFor();
    expect(await deals.getByRole('article').count()).toBe(1);
    await section(page, 'My tasks').getByText('Nothing due today').waitFor();
  });

  it('checks a task there, and its counts follow a move on the board', async () => {
    const page = await signedIn('max');
    await expect
      .poll(() => taskTitles(page), { timeout: 5_000 })
      .toEqual(['Overdue call', 'Due today']);
    await page
      .getByRole('region', { name: 'My tasks due', exact: true })
      .getByRole('checkbox', { name: 'Overdue call' })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Marked Overdue call done' })
      .waitFor({ state: 'attached' });
    await expect
      .poll(() => taskTitles(page), { timeout: 5_000 })
      .toEqual(['Due today']);
    // None of mine is overdue now: the sidebar's link has no count.
    await page
      .locator('[data-sidebar="menu"]')
      .getByRole('link', { name: /^Tasks$/ })
      .waitFor();

    // A move on the board, then back Home: the pipeline reads again.
    await page
      .locator('[data-sidebar="menu"]')
      .getByRole('link', { name: 'Deals' })
      .click();
    await page.getByRole('button', { name: 'Actions for Rocket fuel' }).click();
    await page.getByRole('menuitem', { name: 'Qualified' }).click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Moved Rocket fuel to Qualified' })
      .waitFor({ state: 'attached' });
    await page
      .locator('[data-sidebar="menu"]')
      .getByRole('link', { name: 'Home' })
      .click();
    await expect.poll(() => tile(page, 'Lead'), { timeout: 5_000 }).toBe('0');
    expect(await tile(page, 'Qualified')).toBe('2');
  });

  it('shows a failed section’s retry, and the other sections', async () => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.route(/\/rpc\/activities[./]find/, (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );
    await page.goto(new URL('/', base).href);
    await page.getByLabel('Email').fill('max@crm.test');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const recent = section(page, 'Recent activity');
    await recent
      .getByText('The latest activity could not be loaded.')
      .waitFor();
    await page
      .getByRole('list', { name: 'My open deals' })
      .getByRole('article')
      .first()
      .waitFor();
    await expect
      .poll(() => tile(page, 'Proposal'), { timeout: 5_000 })
      .toBe('1');

    await page.unroute(/\/rpc\/activities[./]find/);
    await recent.getByRole('button', { name: 'Try again' }).click();
    await page
      .getByRole('list', { name: 'Recent activity' })
      .getByText('Called about the fuel order.')
      .waitFor();
  });

  it('lists the team with their roles, and says which is you', async () => {
    const page = await signedIn('mia', '/team');
    const table = page.getByRole('table', { name: 'Team' });
    await table.getByRole('row').nth(2).waitFor();
    const rows = await table
      .getByRole('row')
      .evaluateAll((trs) =>
        trs
          .slice(1)
          .map((tr) =>
            [...tr.querySelectorAll('td')].map((td) => td.textContent),
          ),
      );
    expect(rows).toEqual([
      ['MMMax Mann', 'Manager'],
      ['MMMia MossYou', 'Member'],
    ]);
    await page.getByText('Roles are managed by an administrator.').waitFor();
  });
});
