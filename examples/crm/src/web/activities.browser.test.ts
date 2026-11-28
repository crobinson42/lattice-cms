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

// Activities, in the built app in headless Chromium, against the real HTTP
// server on a port and MongoDB: a call logged on a deal shows on the deal's
// timeline and its company's, grouped by day; a refused body; editing and
// deleting one's own; no Edit or Delete on another member's; one deleted
// behind the page leaves it when it is acted on.

const password = 'correct horse battery';

describe('activities in a browser', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running;
  let browser: Browser;
  let base: URL;
  const ids = { rockets: '', fuel: '' };
  // Deletes Max's "Sent the contract." behind the page, as another tab would.
  let deleteBehind = async () => {};

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
    const rockets = await max.companies.create({ name: 'Acme Rockets' });
    const fuel = await max.deals.create({
      title: 'Rocket fuel',
      companyId: rockets.id,
      amount: 1000,
    });
    ids.rockets = rockets.id;
    ids.fuel = fuel.id;
    const sent = await max.activities.log({
      kind: 'email',
      body: 'Sent the contract.',
      occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      dealId: fuel.id,
      companyId: rockets.id,
    });
    deleteBehind = async () => {
      await max.activities.delete({ id: sent.id });
    };
    // Mia's note on the deal, yesterday, by the parents rule.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await client('mia', 'member').activities.log({
      kind: 'note',
      body: 'Budget is signed off.\nThey want a pilot first.',
      occurredAt: yesterday.toISOString(),
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

  async function signedIn(path: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL(path, base).href);
    await page.getByLabel('Email').fill('max@crm.test');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    return page;
  }

  const timeline = (page: Page, name: string) =>
    page.getByRole('region', { name: `Activity on ${name}`, exact: true });

  const focused = (page: Page) =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent,
    );

  it('logs a call on a deal, on its timeline and its company’s, grouped by day', async () => {
    const page = await signedIn(`/deals/${ids.fuel}`);
    await timeline(page, 'Rocket fuel').waitFor();
    await page
      .getByRole('button', { name: 'Log a note, call, email or meeting…' })
      .click();
    // The composer opens on its first field.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toBe(await page.getByLabel('Kind').getAttribute('id'));
    await page.getByLabel('Kind').selectOption({ label: 'Call' });
    await page.getByLabel('What happened').fill('Discussed pricing.');
    await page.getByRole('button', { name: 'Log activity' }).click();
    await page.getByText('Call logged').waitFor();
    const deal = timeline(page, 'Rocket fuel');
    // Today's call first, then yesterday's note, each under its day.
    await deal.getByRole('heading', { name: 'Today' }).waitFor();
    await deal.getByRole('heading', { name: 'Yesterday' }).waitFor();
    expect(await deal.getByRole('article').first().textContent()).toContain(
      'Discussed pricing.',
    );
    // The composer folds back up, and focus is on it.
    await expect
      .poll(() => focused(page))
      .toBe('Log a note, call, email or meeting…');

    // The company's timeline has it too, linked to its deal.
    await page.goto(new URL(`/companies/${ids.rockets}`, base).href);
    const company = timeline(page, 'Acme Rockets');
    const call = company
      .getByRole('article')
      .filter({ hasText: 'Discussed pricing.' });
    await call.waitFor();
    expect(
      await call
        .getByRole('link', { name: 'Rocket fuel' })
        .getAttribute('href'),
    ).toBe(`/deals/${ids.fuel}`);
    // Mia's note keeps its line break.
    expect(
      await company
        .getByRole('article')
        .filter({ hasText: 'Budget is signed off.' })
        .locator('p')
        .innerText(),
    ).toBe('Budget is signed off.\nThey want a pilot first.');
  });

  it('refuses an empty body at its field', async () => {
    const page = await signedIn(`/deals/${ids.fuel}`);
    await page
      .getByRole('button', { name: 'Log a note, call, email or meeting…' })
      .click();
    await page.getByRole('button', { name: 'Log activity' }).click();
    await page.getByText('Say what happened').waitFor();
    expect(
      await page.getByLabel('What happened').getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('edits and deletes one’s own activity, and offers neither on another member’s', async () => {
    const page = await signedIn(`/deals/${ids.fuel}`);
    const deal = timeline(page, 'Rocket fuel');
    await deal.getByRole('article').first().waitFor();
    // Mia's note: no Edit, no Delete.
    const note = deal
      .getByRole('article')
      .filter({ hasText: 'Budget is signed off.' });
    expect(await note.getByRole('button').count()).toBe(0);

    await deal.getByRole('button', { name: 'Edit this call' }).click();
    const body = page.getByRole('dialog').getByLabel('What happened');
    expect(await body.inputValue()).toBe('Discussed pricing.');
    await body.fill('Discussed pricing and the pilot.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await deal.getByText('Discussed pricing and the pilot.').waitFor();

    await deal.getByRole('button', { name: 'Delete this call' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByText('Deleted', { exact: true }).waitFor();
    await expect
      .poll(() => deal.getByText('Discussed pricing and the pilot.').count())
      .toBe(0);
    // Its row is gone: focus goes back to the composer.
    await expect
      .poll(() => focused(page))
      .toBe('Log a note, call, email or meeting…');
  });

  it('says an activity deleted behind the page is gone, and drops its row', async () => {
    const page = await signedIn(`/deals/${ids.fuel}`);
    const deal = timeline(page, 'Rocket fuel');
    await deal.getByText('Sent the contract.').waitFor();
    await deleteBehind();
    await deal.getByRole('button', { name: 'Delete this email' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page
      .getByText('That activity is no longer there to change.')
      .waitFor();
    await expect
      .poll(() => deal.getByText('Sent the contract.').count())
      .toBe(0);
  });
});
