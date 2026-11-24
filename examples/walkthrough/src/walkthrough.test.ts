import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pack, runReadme, type Started } from './runner.js';

// The root README's Getting started, run as written in an empty directory,
// then the admin it ends with, driven in Chromium as its prose says. The
// @latticecms packages are tarballs of this checkout, unless
// WALKTHROUGH_FROM=registry installs the published ones.

const repo = fileURLToPath(new URL('../../../', import.meta.url));

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

describe('Getting started', () => {
  let root = '';
  let started: Started | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'lattice-walkthrough-'));
    const tarballs =
      process.env.WALKTHROUGH_FROM === 'registry'
        ? undefined
        : await pack(repo, join(root, 'tarballs'));
    const dir = join(root, 'my-app');
    await mkdir(dir);
    started = await runReadme({
      readme: join(repo, 'README.md'),
      heading: 'Getting started',
      dir,
      tarballs,
    });
    browser = await launch();
  });

  afterAll(async () => {
    await browser?.close();
    started?.stop();
    await rm(root, { recursive: true, force: true });
  });

  /** The token the README's start block sets. */
  function token(): string {
    const found = /ADMIN_TOKEN=(\S+)/.exec(started?.script ?? '')?.[1];
    if (found === undefined)
      throw new Error('the start block sets no ADMIN_TOKEN');
    return found;
  }

  async function confirm(page: Page, action: string) {
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: action })
      .click();
  }

  async function openList(page: Page, label: string) {
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: label }).waitFor();
  }

  it('signs in with the token, and creates, edits and deletes companies and contacts', async () => {
    if (started === undefined || browser === undefined) {
      throw new Error('the walkthrough did not start');
    }
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/admin', started.url).href);

    // Sign in with the token the server was started with.
    await page.getByLabel('Token').fill(token());
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Collections' }).waitFor();

    // A company, and its page survives a reload.
    await openList(page, 'Companies');
    await page.getByRole('link', { name: 'New company' }).click();
    await page.getByLabel('Name').fill('Acme');
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.getByRole('heading', { name: 'Acme' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Acme' }).waitFor();

    // A contact at that company, picked by searching its name.
    await openList(page, 'Contacts');
    await page.getByRole('link', { name: 'New contact' }).click();
    await page.getByLabel('Name').fill('Ada');
    await page.getByLabel('Company id').fill('Acm');
    await page.getByRole('button', { name: 'Acme' }).click();
    await page.getByRole('button', { name: 'Create contact' }).click();
    await page.getByRole('heading', { name: 'Ada' }).waitFor();

    // Edited.
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('Ada Lovelace');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('heading', { name: 'Ada Lovelace' }).waitFor();

    // The company cannot go while its contact refers to it.
    await openList(page, 'Companies');
    await page.getByRole('link', { name: 'Acme' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page
      .getByRole('link', {
        name: 'Contacts still refer to this company (Company id).',
      })
      .click();
    await page.getByRole('heading', { name: 'Contacts' }).waitFor();

    // The contact goes, then the company.
    await page.getByRole('link', { name: 'Ada Lovelace' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page.getByRole('heading', { name: 'Contacts' }).waitFor();
    await openList(page, 'Companies');
    await page.getByRole('link', { name: 'Acme' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await page.getByRole('heading', { name: 'Companies' }).waitFor();
    // The list shows its cached page until it refetches on mount, about one
    // fetch, so the deleted company leaves rather than never shows.
    await page
      .getByRole('link', { name: 'Acme' })
      .waitFor({ state: 'detached' });
  });
});
