import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { adminApp, manager, member } from './test/app.js';
import { admin, firstCells, open, seeded } from './test/screen.js';

afterEach(cleanup);

function headers(): (string | null)[] {
  return screen
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
}

/** Adds a filter on the field labelled `label`. */
function addFilter(label: string) {
  const picker = screen.getByLabelText('Filter by');
  const option = within(picker).getByRole('option', { name: label });
  fireEvent.change(picker, {
    target: { value: option.getAttribute('value') },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
}

/** Adds and applies the filter "Stage is won". */
async function filterWon() {
  addFilter('Stage');
  fireEvent.change(screen.getByLabelText('Stage value'), {
    target: { value: 'won' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(firstCells()).toEqual(['B deal']));
}

function filterOptions(): string[] {
  return within(screen.getByLabelText('Filter by'))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

function inputValue(label: string): string | null {
  return screen.getByLabelText(label).getAttribute('value');
}

/** The browser's back or forward: the move, then popstate. */
function travel(move: 'back' | 'forward') {
  act(() => {
    window.history[move]();
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('the collection index', () => {
  it('lists every collection by its label, and links to its list', async () => {
    const { app } = await seeded();
    open('/admin', app.fetch);
    expect(await screen.findByRole('link', { name: 'Companies' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeTruthy();
    const deals = screen.getByRole('link', { name: 'Deals' });
    expect(deals.getAttribute('href')).toBe('/admin/deals');

    fireEvent.click(deals);
    expect(await screen.findByRole('heading', { name: 'Deals' })).toBeTruthy();
    expect(window.location.pathname).toBe('/admin/deals');
  });

  it('works under a base path with a trailing slash', async () => {
    const { app, big } = await seeded();
    open('/admin/deals', app.fetch, { basePath: '/admin/' });
    const link = await screen.findByRole('link', { name: 'B deal' });
    expect(link.getAttribute('href')).toBe(`/admin/deals/${big.id}`);
    const home = screen.getByRole('link', { name: 'Admin' });
    expect(home.getAttribute('href')).toBe('/admin');
  });
});

describe('a list', () => {
  it('shows the title field, the required scalars and updatedAt, with refs by title', async () => {
    const { app } = await seeded();
    app.actAs(manager);
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');
    expect(headers()).toEqual([
      'Title',
      'Company id',
      'Deal value',
      'Stage',
      'Updated at',
    ]);
    expect(screen.getAllByRole('link', { name: 'Acme' }).length).toBe(2);
    expect(screen.getByText('3 results')).toBeTruthy();
  });

  it('leaves out the column of a field the caller may not read', async () => {
    const { app } = await seeded();
    app.actAs(member);
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');
    expect(headers()).toEqual(['Title', 'Company id', 'Stage', 'Updated at']);
  });

  it('sorts by one column, ascending then descending', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');

    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    await waitFor(() =>
      expect(firstCells()).toEqual(['A deal', 'B deal', 'C deal']),
    );
    fireEvent.click(screen.getByRole('button', { name: /Title/ }));
    await waitFor(() =>
      expect(firstCells()).toEqual(['C deal', 'B deal', 'A deal']),
    );
    expect(window.location.search).toBe('?sort=-title');
  });

  it('gives a header no sort button when find cannot sort by it', async () => {
    const { app } = await seeded();
    open('/admin/companies', app.fetch);
    await screen.findByText('Acme');
    expect(headers()).toContain('Active');
    expect(screen.queryByRole('button', { name: 'Active' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Updated at' })).toBeTruthy();
  });

  it('filters by a field with its operators, and counts what matches', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');
    await filterWon();
    expect(await screen.findByText('1 result')).toBeTruthy();
  });

  it('resets a value when its operator changes', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');

    addFilter('Title');
    fireEvent.change(screen.getByLabelText('Title value'), {
      target: { value: 'B deal' },
    });
    fireEvent.change(screen.getByLabelText('Title operator'), {
      target: { value: 'exists' },
    });
    const exists = screen.getByLabelText('Title value');
    expect(exists.tagName).toBe('SELECT');
    expect(within(exists).getByRole('option', { name: 'Yes' })).toHaveProperty(
      'selected',
      true,
    );

    fireEvent.change(screen.getByLabelText('Title operator'), {
      target: { value: 'contains' },
    });
    expect(inputValue('Title value')).toBe('');
  });

  it('keeps one condition per field when the app re-renders', async () => {
    const { app } = await seeded();
    const view = open('/admin/deals', app.fetch, { header: <span>One</span> });
    await screen.findByText('B deal');
    addFilter('Stage');

    view.rerender(admin(app.fetch, { header: <span>Two</span> }));
    expect(await screen.findByText('Two')).toBeTruthy();
    expect(screen.getAllByLabelText('Stage value').length).toBe(1);
    expect(filterOptions()).not.toContain('Stage');
  });

  it('pages with Next and Back over cursors', async () => {
    const app = adminApp();
    for (let index = 0; index < 25; index++) {
      await app.repos.companies.insert(
        { name: `Company ${String(index).padStart(2, '0')}` },
        app.scope.companies,
      );
    }
    open('/admin/companies', app.fetch);
    await screen.findByText('25 results');
    await waitFor(() => expect(firstCells().length).toBe(20));
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(firstCells().length).toBe(5));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(firstCells().length).toBe(20));
  });

  it('keeps its filters in the URL, so back and forward return to them', async () => {
    const { app, big } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('A deal');
    await filterWon();

    fireEvent.click(screen.getByRole('link', { name: 'B deal' }));
    expect(await screen.findByRole('heading', { name: 'B deal' })).toBeTruthy();
    expect(window.location.pathname).toBe(`/admin/deals/${big.id}`);

    travel('back');
    await waitFor(() => expect(firstCells()).toEqual(['B deal']));
    const stage = screen.getByLabelText('Stage value');
    expect(within(stage).getByRole('option', { name: 'won' })).toHaveProperty(
      'selected',
      true,
    );

    travel('forward');
    expect(await screen.findByRole('heading', { name: 'B deal' })).toBeTruthy();
  });

  it('starts another collection with no filters', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('A deal');
    await filterWon();

    fireEvent.click(screen.getByRole('link', { name: 'Admin' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Companies' }));
    // Acme only: no caller may read the company named Hidden.
    expect(await screen.findByText('1 result')).toBeTruthy();
    expect(screen.queryByLabelText('Stage value')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('shows a VALIDATION refusal at the filter it names', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');

    addFilter('Deal value');
    fireEvent.change(screen.getByLabelText('Deal value operator'), {
      target: { value: 'gt' },
    });
    fireEvent.change(screen.getByLabelText('Deal value value'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const filters = screen.getByRole('form', { name: 'Filters' });
    const issue = await within(filters).findByRole('alert');
    expect(issue.textContent).toMatch(/amount/);
    // Shown at the filter, not as a page-wide error.
    expect(screen.queryByText('VALIDATION')).toBeNull();
  });

  it('shows a VALIDATION refusal on a sort at its column', async () => {
    const { app } = await seeded();
    app.actAs(manager);
    open('/admin/deals', app.fetch);
    await screen.findByText('Deal value');

    // The caller loses the field mid-session, so the sort is refused.
    app.actAs(member);
    fireEvent.click(screen.getByRole('button', { name: 'Deal value' }));
    const header = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.textContent?.startsWith('Deal value'));
    if (header === undefined) throw new Error('no Deal value column');
    const issue = await within(header).findByRole('alert');
    expect(issue.textContent).toMatch(/amount/);
    expect(screen.queryByText('VALIDATION')).toBeNull();
  });

  it('shows a FORBIDDEN refusal', async () => {
    const app = adminApp();
    open('/admin/notes', app.fetch);
    expect(await screen.findByText('FORBIDDEN')).toBeTruthy();
  });

  it('says when nothing is there', async () => {
    const app = adminApp();
    open('/admin/companies', app.fetch);
    expect(await screen.findByText('No companies')).toBeTruthy();
  });
});

describe('a document', () => {
  it('links a populated ref by its title, with a tab per relation', async () => {
    const { app, acme, big } = await seeded();
    open(`/admin/deals/${big.id}`, app.fetch);
    expect(await screen.findByRole('heading', { name: 'B deal' })).toBeTruthy();
    const company = screen.getByRole('link', { name: 'Acme' });
    expect(company.getAttribute('href')).toBe(`/admin/companies/${acme.id}`);
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeTruthy();
    const system = screen.getByRole('region', { name: 'System fields' });
    expect(within(system).getByText(big.id)).toBeTruthy();
    expect(within(system).getByText('o1')).toBeTruthy();
  });

  it('leaves out a field the caller may not read', async () => {
    const { app, big } = await seeded();
    open(`/admin/deals/${big.id}`, app.fetch);
    await screen.findByRole('heading', { name: 'B deal' });
    expect(screen.queryByText('Deal value')).toBeNull();
    cleanup();

    app.actAs(manager);
    open(`/admin/deals/${big.id}`, app.fetch);
    expect(await screen.findByText('Deal value')).toBeTruthy();
    expect(screen.getByText('4242.5')).toBeTruthy();
  });

  it('shows a ref the caller may not read as its id, with no access', async () => {
    const { app, secret } = await seeded();
    open(`/admin/deals/${secret.id}`, app.fetch);
    expect(await screen.findByText('no access')).toBeTruthy();
    expect(screen.getByText(secret.companyId)).toBeTruthy();
  });

  it('renders not-found for a missing document', async () => {
    const app = adminApp();
    open('/admin/deals/nope', app.fetch);
    expect(await screen.findByText('Not found')).toBeTruthy();
    expect(screen.getByText('No deal with id nope.')).toBeTruthy();
  });
});

describe('routes and the catalog', () => {
  it('renders not-found for an unknown route, collection or malformed path', async () => {
    const app = adminApp();
    open('/admin/deals/one/more/again', app.fetch);
    expect(await screen.findByText('No page here.')).toBeTruthy();
    cleanup();
    open('/admin/nope', app.fetch);
    expect(await screen.findByText('No collection "nope".')).toBeTruthy();
    cleanup();
    open('/admin/%E0%A4', app.fetch);
    expect(await screen.findByText('No page here.')).toBeTruthy();
  });

  it('says why an unreadable catalog cannot be read', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      Response.json({
        catalogVersion: 1,
        prefix: '/rpc',
        procedures: [
          { path: ['deals', 'find'], meta: { lattice: {} }, errors: [] },
        ],
      });
    open('/admin', fetch);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      "The catalog at /catalog.json cannot be read. The catalog's procedures[0].meta.lattice is not Lattice's procedure meta.",
    );
  });
});
