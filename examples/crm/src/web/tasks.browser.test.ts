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

// Tasks, in the built app in headless Chromium, against the real HTTP
// server on a port and MongoDB: the Tasks page's groups, Mine and Everyone;
// creating from the page on a deal and from a company's quick add; done in
// one click, with Undo, focus to the next row, and nothing lost while the
// server is slow; the sidebar's overdue count; editing and deleting.

const password = 'correct horse battery';

/** A plain date `offset` days from today, here: the browser's zone too. */
const day = (offset: number) => {
  const now = new Date();
  return isoDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
};

describe('tasks in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  const ids = { rockets: '', quick: '', busy: '' };

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
    ids.rockets = rockets.id;
    await max.deals.create({
      title: 'Rocket fuel',
      companyId: rockets.id,
      amount: 1000,
    });
    const task = (title: string, assigneeId: string, due?: number) =>
      max.tasks.create({
        title,
        assigneeId,
        companyId: rockets.id,
        ...(due === undefined ? {} : { dueDate: day(due) }),
      });
    // Created in this order: the sort, not the order, must put them right.
    await task('Undated chore', 'max');
    await task('Due today', 'max', 0);
    await task('Overdue call', 'max', -3);
    await task('Mia’s follow-up', 'mia', 2);
    // Two to check in quick succession, and 21 for a section's Load more:
    // Mia's, so Max's own list stays as it is.
    const quick = await max.companies.create({ name: 'Quick Co' });
    ids.quick = quick.id;
    for (const title of ['Quick one', 'Quick two']) {
      await max.tasks.create({ title, assigneeId: 'mia', companyId: quick.id });
    }
    const busy = await max.companies.create({ name: 'Busy Corp' });
    ids.busy = busy.id;
    for (let n = 1; n <= 21; n += 1) {
      await max.tasks.create({
        title: `Busy ${String(n).padStart(2, '0')}`,
        assigneeId: 'mia',
        companyId: busy.id,
      });
    }
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

  const list = (page: Page, name: string) =>
    page.getByRole('region', { name, exact: true });

  const titles = (page: Page, name: string) =>
    list(page, name)
      .getByRole('checkbox')
      .evaluateAll((boxes) =>
        boxes.map(
          (box) =>
            document.getElementById(box.getAttribute('aria-labelledby') ?? '')
              ?.textContent,
        ),
      );

  /**
   * The sidebar's Tasks link: its name carries my overdue count. Chrome
   * puts a space before the comma, as a flex item is a block to it.
   */
  const tasksLink = (page: Page, overdue: number) =>
    page.locator('[data-sidebar="menu"]').getByRole('link', {
      name:
        overdue === 0 ? /^Tasks$/ : new RegExp(`^Tasks ?, ${overdue} overdue$`),
    });

  /**
   * Holds each write of `done` for a second, as a slow server
   * would; every other request goes straight through.
   */
  const slowDone = (page: Page) =>
    page.route(/\/rpc\/tasks[./]update/, async (route) => {
      if (route.request().postData()?.includes('"done"') === true) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    });

  const focusedName = (page: Page) =>
    page.evaluate(() => {
      const active = document.activeElement;
      const label = active?.getAttribute('aria-labelledby');
      return label === null || label === undefined
        ? active?.textContent
        : document.getElementById(label)?.textContent;
    });

  it('groups my open tasks by due date, undated last, and shows everyone’s on asking', async () => {
    const page = await signedIn('/tasks');
    const open = list(page, 'Open tasks');
    await open.getByRole('checkbox').first().waitFor();
    expect(await open.getByRole('heading').allTextContents()).toEqual([
      'Overdue',
      'Today',
      'No due date',
    ]);
    expect(await titles(page, 'Open tasks')).toEqual([
      'Overdue call',
      'Due today',
      'Undated chore',
    ]);
    expect(
      await open
        .getByRole('article')
        .filter({ hasText: 'Overdue call' })
        .getByText(/^Overdue, /)
        .count(),
    ).toBe(1);

    await page.getByRole('button', { name: 'Everyone' }).click();
    await open.getByText('Mia’s follow-up', { exact: true }).waitFor();
    expect(new URL(page.url()).search).toBe('?who=everyone');
    expect(await open.getByRole('heading').allTextContents()).toEqual([
      'Overdue',
      'Today',
      'This week',
      'No due date',
    ]);
  });

  it('creates a task on a deal from the Tasks page, on its company too', async () => {
    const page = await signedIn('/tasks');
    await list(page, 'Open tasks').getByRole('checkbox').first().waitFor();
    await page.getByRole('button', { name: 'New task' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Related to').selectOption({ label: 'Deal' });
    await sheet.getByLabel('Deal').fill('Rocket');
    await page.getByRole('option', { name: 'Rocket fuel' }).click();
    await sheet.getByLabel('Title').fill('Send the contract');
    await sheet.getByRole('button', { name: 'Create task' }).click();
    await page.getByText('Created Send the contract').waitFor();
    // Mine: the assignee is the signed-in member unless picked.
    const created = list(page, 'Open tasks')
      .getByRole('article')
      .filter({ hasText: 'Send the contract' });
    await created.getByRole('link', { name: 'Rocket fuel' }).waitFor();
    await created.getByRole('link', { name: 'Acme Rockets' }).waitFor();

    await page.goto(new URL(`/companies/${ids.rockets}`, base).href);
    await list(page, 'Tasks on Acme Rockets')
      .getByText('Send the contract', { exact: true })
      .waitFor();
  });

  it('adds a task from a company’s section, and keeps the title for the next', async () => {
    const page = await signedIn(`/companies/${ids.rockets}`);
    const add = page.getByRole('form', { name: 'Add a task' });
    await add.getByLabel('New task').fill('Book a demo');
    await add.getByLabel('Due').fill(day(5));
    await add.getByRole('button', { name: 'Add' }).click();
    await page.getByText('Added Book a demo').waitFor();
    await list(page, 'Tasks on Acme Rockets')
      .getByText('Book a demo', { exact: true })
      .waitFor();
    expect(await add.getByLabel('New task').inputValue()).toBe('');
    expect(
      await add
        .getByLabel('New task')
        .evaluate((input) => input === document.activeElement),
    ).toBe(true);
  });

  it('marks a task done at once, says so, moves it to Done with focus on the next, and undoes it', async () => {
    const page = await signedIn('/tasks');
    const open = list(page, 'Open tasks');
    await open.getByRole('checkbox').first().waitFor();
    await tasksLink(page, 1).waitFor();
    await slowDone(page);

    const box = open.getByRole('checkbox', { name: 'Overdue call' });
    await box.click();
    // Checked before the server answers.
    expect(await box.getAttribute('aria-checked')).toBe('true');
    await page
      .getByRole('status')
      .filter({ hasText: 'Marked Overdue call done' })
      .waitFor({ state: 'attached' });
    // The lists read again: it leaves Open, and focus goes to the next box.
    await expect
      .poll(() => titles(page, 'Open tasks'), { timeout: 5_000 })
      .not.toContain('Overdue call');
    await expect.poll(() => focusedName(page)).toBe('Due today');
    await tasksLink(page, 0).waitFor();

    await page.getByRole('button', { name: /^Show done/ }).click();
    await list(page, 'Done tasks')
      .getByText('Overdue call', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(() => titles(page, 'Open tasks'), { timeout: 5_000 })
      .toContain('Overdue call');
    await tasksLink(page, 1).waitFor();
    expect(await titles(page, 'Done tasks')).not.toContain('Overdue call');
  }, 20_000);

  it('keeps two quick checks, each its own write', async () => {
    const page = await signedIn(`/companies/${ids.quick}`);
    const section = list(page, 'Tasks on Quick Co');
    await section.getByRole('checkbox').first().waitFor();
    await slowDone(page);
    await section.getByRole('checkbox', { name: 'Quick one' }).click();
    await section.getByRole('checkbox', { name: 'Quick two' }).click();
    expect(
      await section
        .getByRole('checkbox')
        .evaluateAll((boxes) =>
          boxes.map((box) => box.getAttribute('aria-checked')),
        ),
    ).toEqual(['true', 'true']);
    await section.getByText('No open tasks').waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Show done (2)' }).click();
    await expect
      .poll(() => titles(page, 'Done tasks'), { timeout: 5_000 })
      .toEqual(expect.arrayContaining(['Quick one', 'Quick two']));
  }, 20_000);

  it('loses no Load more, quick add or edit made while a check is on its way', async () => {
    const page = await signedIn(`/companies/${ids.busy}`);
    const section = list(page, 'Tasks on Busy Corp');
    await section.getByRole('checkbox').first().waitFor();
    await slowDone(page);
    await section.getByRole('checkbox', { name: 'Busy 01' }).click();
    // All while Busy 01 waits for the server.
    await section.getByRole('button', { name: 'Load more' }).click();
    await section.getByText('Busy 21', { exact: true }).waitFor();
    const add = page.getByRole('form', { name: 'Add a task' });
    await add.getByLabel('New task').fill('Late addition');
    await add.getByRole('button', { name: 'Add' }).click();
    await page.getByText('Added Late addition').waitFor();
    await section.getByRole('button', { name: 'Edit Busy 02' }).click();
    await page.getByRole('dialog').getByLabel('Title').fill('Busy 02 renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();

    await expect
      .poll(() => titles(page, 'Tasks on Busy Corp'), { timeout: 5_000 })
      .not.toContain('Busy 01');
    const shown = await titles(page, 'Tasks on Busy Corp');
    expect(shown).toContain('Busy 21');
    expect(shown).toContain('Late addition');
    expect(shown).toContain('Busy 02 renamed');
    expect(shown).toHaveLength(21);
  }, 20_000);

  it('edits a task into another group, then deletes it', async () => {
    const page = await signedIn('/tasks');
    const open = list(page, 'Open tasks');
    await open.getByRole('checkbox').first().waitFor();
    await page.getByRole('button', { name: 'Edit Undated chore' }).click();
    await page.getByRole('dialog').getByLabel('Due').fill(day(0));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await expect
      .poll(() => titles(page, 'Open tasks'))
      // Due today too, and created first: equal dates fall back to createdAt.
      .toEqual([
        'Overdue call',
        'Undated chore',
        'Due today',
        'Book a demo',
        'Send the contract',
        // Busy Corp's quick add: the signed-in member's.
        'Late addition',
      ]);
    // Focus follows the row to its new group.
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      )
      .toBe('Edit Undated chore');

    await page.getByRole('button', { name: 'Delete Undated chore' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByText('Deleted Undated chore').waitFor();
    await expect
      .poll(() => titles(page, 'Open tasks'), { timeout: 5_000 })
      .toEqual([
        'Overdue call',
        'Due today',
        'Book a demo',
        'Send the contract',
        // Busy Corp's quick add: the signed-in member's.
        'Late addition',
      ]);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent), {
        timeout: 5_000,
      })
      .toBe('New task');
  });
});
