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

// The pipeline board, in the built app in headless Chromium, against the
// real HTTP server on a port and MongoDB: its columns and counts, a move by
// keyboard through a card's menu, a move by drag and drop, closing from a
// card, and what a member sees on it.

const password = 'correct horse battery';

describe('the pipeline board in a browser', () => {
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
    const max = createLocalClient(crm.app, {
      context: {
        actor: { userId: 'max', organizationId: orgA.id, role: 'manager' },
        logger: new NoopLogger(),
      },
    });
    const rockets = await max.companies.create({ name: 'Acme Rockets' });
    const deal = (title: string, stage: 'lead' | 'proposal') =>
      max.deals.create({ title, companyId: rockets.id, amount: 1000, stage });
    await deal('Line sensors', 'lead');
    await deal('Fuel pumps', 'lead');
    await deal('Rocket fuel', 'proposal');
    // Overdue: an open deal past its expected close date.
    await max.deals.create({
      title: 'Late launch',
      companyId: rockets.id,
      amount: 500,
      stage: 'proposal',
      expectedCloseDate: '2020-01-01',
    });
    const won = await deal('Old order', 'lead');
    await max.deals.close({ id: won.id, outcome: 'won' });
    const lost = await deal('Lost bid', 'lead');
    await max.deals.close({ id: lost.id, outcome: 'lost' });
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

  async function board(who: 'max' | 'mia'): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/deals', base).href);
    await page.getByLabel('Email').fill(`${who}@crm.test`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('list', { name: 'Lead' }).waitFor();
    return page;
  }

  const titles = (page: Page, stage: string) =>
    page
      .getByRole('list', { name: stage })
      .getByRole('article')
      .getByRole('link')
      .allTextContents();

  /** The board's announcement: visually hidden, so attached, not visible. */
  const announced = (page: Page, text: string) =>
    page
      .getByRole('status')
      .filter({ hasText: text })
      .waitFor({ state: 'attached' });

  it('shows a column per open stage with its count, and the closed ones under it', async () => {
    const page = await board('max');
    await expect
      .poll(() => titles(page, 'Lead'))
      .toEqual(expect.arrayContaining(['Line sensors', 'Fuel pumps']));
    for (const stage of ['Lead', 'Qualified', 'Proposal', 'Negotiation']) {
      await page
        .getByRole('region', { name: new RegExp(`^${stage}`) })
        .waitFor();
    }
    expect(
      await page.getByRole('heading', { name: /^Lead/ }).textContent(),
    ).toBe('Lead, 2 deals');
    expect(await page.getByRole('list', { name: 'Won' }).count()).toBe(0);
    expect(
      await page.getByRole('link', { name: '1 won' }).getAttribute('href'),
    ).toBe('/deals?view=table&stage=won');
    await page.getByRole('link', { name: '1 lost' }).waitFor();
  });

  it('moves a deal with the keyboard, through its menu, and says so', async () => {
    const page = await board('max');
    await page
      .getByRole('button', { name: 'Actions for Line sensors' })
      .focus();
    await page.keyboard.press('Enter');
    // The menu opens on its first item, the next stage.
    await page.getByRole('menuitem', { name: 'Qualified' }).waitFor();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toBe('Qualified');
    await page.keyboard.press('Enter');
    await announced(page, 'Moved Line sensors to Qualified');
    // Said only once the columns have read again: the card is there now.
    expect(await titles(page, 'Qualified')).toEqual(['Line sensors']);
    expect(await titles(page, 'Lead')).not.toContain('Line sensors');
    // The keyboard follows the card to its new column.
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      )
      .toBe('Actions for Line sensors');
    expect(
      await page
        .getByRole('list', { name: 'Qualified' })
        .getByRole('button', { name: 'Actions for Line sensors' })
        .evaluate((button) => button === document.activeElement),
    ).toBe(true);
  });

  it('moves a deal by drag and drop', async () => {
    const page = await board('max');
    const card = page
      .getByRole('list', { name: 'Lead' })
      .getByRole('listitem')
      .filter({ hasText: 'Fuel pumps' });
    await card.dragTo(page.getByRole('region', { name: /^Negotiation/ }));
    await announced(page, 'Moved Fuel pumps to Negotiation');
    await expect
      .poll(() => titles(page, 'Negotiation'))
      .toEqual(['Fuel pumps']);
  });

  it('returns focus to the card’s menu when its close dialog is cancelled', async () => {
    const page = await board('max');
    await page.getByRole('button', { name: 'Actions for Fuel pumps' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Close as won…' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', {
      name: 'Close Fuel pumps as won?',
    });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      )
      .toBe('Actions for Fuel pumps');
    // Nothing is left hidden from assistive tech: the board is reachable.
    await page.getByRole('list', { name: 'Lead' }).waitFor();
    expect(
      await page.evaluate(
        () => document.querySelectorAll('main [aria-hidden="true"] a').length,
      ),
    ).toBe(0);
  });

  it('closes a deal from its card, through the same dialog as its page', async () => {
    const page = await board('max');
    await page.getByRole('button', { name: 'Actions for Rocket fuel' }).click();
    await page.getByRole('menuitem', { name: 'Close as won…' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Close Rocket fuel as won?',
    });
    await dialog.getByRole('button', { name: 'Close as won' }).click();
    await page.getByText('Closed Rocket fuel as won').waitFor();
    await page.getByRole('link', { name: '2 won' }).waitFor();
    expect(await titles(page, 'Proposal')).not.toContain('Rocket fuel');
  });

  it('shows a member withheld amounts, and an overdue date in red', async () => {
    const page = await board('mia');
    const late = page
      .getByRole('list', { name: 'Proposal' })
      .getByRole('article')
      .filter({ hasText: 'Late launch' });
    await late.getByText('Withheld').waitFor();
    await late.getByText('overdue').waitFor();
    expect(
      await late
        .getByText('overdue')
        .evaluate((node) =>
          node.parentElement?.className.includes('text-destructive'),
        ),
    ).toBe(true);
  });
});
