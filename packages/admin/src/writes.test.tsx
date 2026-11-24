import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApp, viewer } from './test/app.js';
import { firstCells, open, seeded } from './test/screen.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function form(name: string) {
  return screen.getByRole('form', { name });
}

/** Answers the open dialog with `button`. */
async function answer(button: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: button }));
}

/** The value a document's page shows for the field labelled `label`. */
function shown(label: string): string | null {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? null;
}

/** Opens the set editor of a deal's contacts. */
async function editContacts(path: string, app: ReturnType<typeof adminApp>) {
  open(path, app.fetch);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit links' }));
  const editor = await screen.findByRole('form', { name: 'Edit contacts' });
  await within(editor).findByText('Cara');
  return editor;
}

/** Adds a link to `name` in the open set editor. */
async function addLink(editor: HTMLElement, search: string, name: string) {
  fireEvent.click(within(editor).getByRole('button', { name: 'Add link' }));
  const links = within(editor).getAllByRole('group', { name: /^Link \d+$/ });
  const added = links.at(-1);
  if (added === undefined) throw new Error('no new link');
  fireEvent.change(within(added).getByLabelText('Contact'), {
    target: { value: search },
  });
  fireEvent.click(await within(added).findByRole('button', { name }));
  return added;
}

describe('create', () => {
  it('shows a VALIDATION issue at its field, then opens the new document', async () => {
    const app = adminApp();
    open('/admin/companies/new', app.fetch);
    await screen.findByRole('heading', { name: 'New company' });
    // Lattice adds these: no input takes them.
    expect(screen.queryByLabelText(/Org id/)).toBeNull();
    expect(screen.queryByLabelText(/Created at/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    const name = within(form('New company'))
      .getByText('Name')
      .closest('[data-slot="field"]');
    if (!(name instanceof HTMLElement)) throw new Error('no Name field');
    expect((await within(name).findByRole('alert')).textContent).not.toBe('');

    type('Name', 'Initech');
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(
      await screen.findByRole('heading', { name: 'Initech' }),
    ).toBeTruthy();
    expect(window.location.pathname).toMatch(/^\/admin\/companies\/[^/]+$/);
    // Untouched fields are left to their defaults: `active` is not sent.
    expect(app.sentTo('/rpc/companies/create').at(-1)).toEqual({
      name: 'Initech',
    });
  });

  it('edits an unsupported field as JSON, and says when it is not JSON', async () => {
    const app = adminApp();
    open('/admin/companies/new', app.fetch);
    await screen.findByRole('heading', { name: 'New company' });
    type('Name', 'Initech');
    type(/Address/, '{ "city": ');
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(await screen.findByText('Enter valid JSON.')).toBeTruthy();
    expect(app.sentTo('/rpc/companies/create')).toEqual([]);

    type(/Address/, '{ "city": "Oslo" }');
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(
      await screen.findByRole('heading', { name: 'Initech' }),
    ).toBeTruthy();
    expect(app.sentTo('/rpc/companies/create').at(-1)).toEqual({
      name: 'Initech',
      address: { city: 'Oslo' },
    });
  });

  it('picks a ref by searching its target’s title, with Enter or a click', async () => {
    const { app, acme } = await seeded();
    open('/admin/contacts/new', app.fetch);
    await screen.findByRole('heading', { name: 'New contact' });
    type('Name', 'Dan');
    type('Email', 'dan@acme.test');
    type('Company id', 'Ac');
    const matches = await screen.findByRole('list', {
      name: 'Matching companies',
    });
    await within(matches).findByRole('button', { name: 'Acme' });
    // Enter picks the first match, and does not submit the form.
    fireEvent.keyDown(screen.getByLabelText('Company id'), { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Clear' })).toBeTruthy();
    expect(app.sentTo('/rpc/contacts/create')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    expect(await screen.findByRole('heading', { name: 'Dan' })).toBeTruthy();
    expect(app.sentTo('/rpc/contacts/create').at(-1)).toEqual({
      name: 'Dan',
      email: 'dan@acme.test',
      companyId: acme.id,
    });
  });

  it('shows FORBIDDEN on a write the caller may not make', async () => {
    const app = adminApp();
    app.actAs(viewer);
    open('/admin/companies/new', app.fetch);
    await screen.findByRole('heading', { name: 'New company' });
    type('Name', 'Initech');
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(await screen.findByText('FORBIDDEN')).toBeTruthy();
  });
});

describe('edit', () => {
  it('sends only the changed fields, and leaves out a withheld one', async () => {
    const { app, big } = await seeded();
    open(`/admin/deals/${big.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('link', { name: 'Edit' }));
    await screen.findByRole('heading', { name: 'Edit deal' });
    // A member may not read the amount, so the form has no field for it.
    expect(screen.queryByLabelText(/Deal value/)).toBeNull();
    expect(screen.getByDisplayValue('B deal')).toBe(
      screen.getByLabelText('Title'),
    );

    type('Title', 'Bigger deal');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByRole('heading', { name: 'Bigger deal' }),
    ).toBeTruthy();
    expect(app.sentTo('/rpc/deals/update')).toEqual([
      { id: big.id, title: 'Bigger deal' },
    ]);
  });

  it('clears an optional field with null', async () => {
    const app = adminApp();
    const acme = await app.repos.companies.insert(
      { name: 'Acme', domain: 'acme.test' },
      app.scope.companies,
    );
    open(`/admin/companies/${acme.id}/edit`, app.fetch);
    await screen.findByRole('heading', { name: 'Edit company' });
    type('Domain', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Acme' });
    expect(app.sentTo('/rpc/companies/update')).toEqual([
      { id: acme.id, domain: null },
    ]);
    expect(
      await app.repos.companies.get(acme.id, app.scope.companies),
    ).not.toHaveProperty('domain');
  });

  it('says a required field is required, and sends nothing', async () => {
    const app = adminApp();
    const acme = await app.repos.companies.insert(
      { name: 'Acme' },
      app.scope.companies,
    );
    open(`/admin/companies/${acme.id}/edit`, app.fetch);
    await screen.findByRole('heading', { name: 'Edit company' });
    type('Name', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeTruthy();
    expect(app.sentTo('/rpc/companies/update')).toEqual([]);
    expect(window.location.pathname).toBe(`/admin/companies/${acme.id}/edit`);
  });

  it('keeps its baseline when the document refetches, so it never sends a stale value', {
    timeout: 10_000,
  }, async () => {
    const { app, big } = await seeded();
    open(`/admin/deals/${big.id}/edit`, app.fetch);
    await screen.findByRole('heading', { name: 'Edit deal' });
    const reads = app.sentTo('/rpc/deals/get').length;
    // swr dedupes a key's requests for 2 s of real time.
    await new Promise((resolve) => setTimeout(resolve, 2100));

    // Someone else changes the stage; the window regains focus past swr's
    // throttle, so the document refetches under the form.
    await app.repos.deals.update(big.id, { stage: 'lost' }, app.scope.deals);
    const later = Date.now() + 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(app.sentTo('/rpc/deals/get').length).toBeGreaterThan(reads),
    );

    type('Title', 'Bigger deal');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(app.sentTo('/rpc/deals/update').length).toBe(1));
    expect(app.sentTo('/rpc/deals/update')).toEqual([
      { id: big.id, title: 'Bigger deal' },
    ]);
  });
});

describe('delete', () => {
  it('asks first, then shows the list', async () => {
    const app = adminApp();
    const lonely = await app.repos.companies.insert(
      { name: 'Lonely' },
      app.scope.companies,
    );
    open(`/admin/companies/${lonely.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await answer('Delete');
    expect(
      await screen.findByRole('heading', { name: 'Companies' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/admin/companies');
    expect(app.sentTo('/rpc/companies/delete')).toEqual([{ id: lonely.id }]);
  });

  it('never shows the deleted document in its list, not even before the list refetches', async () => {
    const app = adminApp();
    await app.repos.companies.insert({ name: 'Other' }, app.scope.companies);
    await app.repos.companies.insert({ name: 'Lonely' }, app.scope.companies);
    open('/admin/companies', app.fetch);
    fireEvent.click(await screen.findByRole('link', { name: 'Lonely' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // The list's refetch waits, so a cached page would render meanwhile.
    const release = app.hold('/rpc/companies/find');
    await answer('Delete');
    await screen.findByRole('heading', { name: 'Companies' });
    expect(screen.queryAllByRole('link', { name: 'Lonely' })).toEqual([]);
    release();
    await screen.findByRole('link', { name: 'Other' });
    expect(screen.queryAllByRole('link', { name: 'Lonely' })).toEqual([]);
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const app = adminApp();
    const lonely = await app.repos.companies.insert(
      { name: 'Lonely' },
      app.scope.companies,
    );
    open(`/admin/companies/${lonely.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await answer('Cancel');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(app.sentTo('/rpc/companies/delete')).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Lonely' })).toBeTruthy();
  });

  it('explains REFERENCED, with a link to the documents that refer to it', async () => {
    const { app, acme } = await seeded();
    open(`/admin/companies/${acme.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await answer('Delete');
    const blocked = await screen.findByRole('link', {
      name: 'Contacts still refer to this company (Company id).',
    });
    fireEvent.click(blocked);
    await waitFor(() => expect(firstCells()).toEqual(['Cara']));
    expect(window.location.pathname).toBe('/admin/contacts');
    expect(screen.getByLabelText('Company id value')).toBeTruthy();
  });

  it('explains a REFERENCED from a relation, with a link to the parents’ list', async () => {
    const { app, cara } = await seeded();
    open(`/admin/contacts/${cara.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await answer('Delete');
    const blocked = await screen.findByRole('link', {
      name: 'Deals still list this contact (Contacts).',
    });
    fireEvent.click(blocked);
    await screen.findByRole('heading', { name: 'Deals' });
    expect(window.location.pathname).toBe('/admin/deals');
  });
});

describe('a method', () => {
  it('runs on its document, and shows its declared error', async () => {
    const { app, big } = await seeded();
    open(`/admin/deals/${big.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    const close = await screen.findByRole('form', { name: 'Close' });
    // Its input but `id`, which the page supplies.
    expect(within(close).queryByLabelText(/^Id/)).toBeNull();
    fireEvent.change(within(close).getByLabelText('Outcome'), {
      target: { value: 'lost' },
    });
    fireEvent.click(within(close).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('AlreadyClosed')).toBeTruthy();
    expect(screen.getByText('The deal is already closed')).toBeTruthy();
    expect(app.sentTo('/rpc/deals/close')).toEqual([
      { outcome: 'lost', id: big.id },
    ]);
  });

  it('refreshes its document when it returns it', async () => {
    const app = adminApp();
    const company = await app.repos.companies.insert(
      { name: 'X' },
      app.scope.companies,
    );
    const fresh = await app.repos.deals.insert(
      { title: 'Fresh', companyId: company.id, amount: 1 },
      app.scope.deals,
    );
    open(`/admin/deals/${fresh.id}`, app.fetch);
    await screen.findByRole('heading', { name: 'Fresh' });
    expect(shown('Stage')).toBe('lead');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const close = await screen.findByRole('form', { name: 'Close' });
    fireEvent.change(within(close).getByLabelText('Outcome'), {
      target: { value: 'won' },
    });
    fireEvent.click(within(close).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Close' })).toBeNull(),
    );
    await waitFor(() => expect(shown('Stage')).toBe('won'));
  });

  it('runs a read on its collection at once, and shows what it returned', async () => {
    const { app } = await seeded();
    open('/admin/deals', app.fetch);
    await screen.findByText('B deal');
    fireEvent.click(screen.getByRole('button', { name: 'Count won' }));
    const result = await screen.findByRole('region', {
      name: 'Count won result',
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(result).getByText('Count')).toBeTruthy();
    expect(within(result).getByText('1')).toBeTruthy();
  });
});

describe('a relation', () => {
  it('lists its links on a tab, each going to its target', async () => {
    const { app, big, cara } = await seeded();
    open(`/admin/deals/${big.id}`, app.fetch);
    fireEvent.click(await screen.findByRole('link', { name: 'Contacts' }));
    expect(window.location.pathname).toBe(
      `/admin/deals/${big.id}/relations/contacts`,
    );
    const tab = await screen.findByRole('region', { name: 'Contacts' });
    expect(within(tab).getByText('1 link')).toBeTruthy();
    const target = await within(tab).findByRole('link', { name: 'Cara' });
    expect(target.getAttribute('href')).toBe(`/admin/contacts/${cara.id}`);
    expect(within(tab).getByText('champion')).toBeTruthy();
  });

  it('sets the whole set after asking, with titles from the list', async () => {
    const { app, acme, big, cara } = await seeded();
    const dora = await app.repos.contacts.insert(
      { name: 'Dora', email: 'dora@acme.test', companyId: acme.id },
      app.scope.contacts,
    );
    const editor = await editContacts(
      `/admin/deals/${big.id}/relations/contacts`,
      app,
    );
    // Cara's title came with the list: no get for it.
    expect(app.sentTo('/rpc/contacts/get')).toEqual([]);

    const added = await addLink(editor, 'Do', 'Dora');
    fireEvent.change(within(added).getByLabelText('Role'), {
      target: { value: 'other' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save links' }));
    await answer('Save links');

    expect(await screen.findByText('2 links')).toBeTruthy();
    expect(app.sentTo('/rpc/deals/contacts/set')).toEqual([
      {
        id: big.id,
        links: [
          { contactsId: cara.id, role: 'champion' },
          { contactsId: dora.id, role: 'other' },
        ],
      },
    ]);
    // Newest first: the list's default sort.
    expect(firstCells()).toEqual(['Dora', 'Cara']);
  });

  it('removes a link', async () => {
    const { app, big } = await seeded();
    const editor = await editContacts(
      `/admin/deals/${big.id}/relations/contacts`,
      app,
    );
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Remove link' }),
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Save links' }));
    await answer('Save links');
    expect(await screen.findByText('0 links')).toBeTruthy();
    expect(app.sentTo('/rpc/deals/contacts/set')).toEqual([
      { id: big.id, links: [] },
    ]);
  });

  it('keeps the edits when set is refused', async () => {
    const { app, big } = await seeded();
    await app.repos.contacts.insert(
      { name: 'Dora', email: 'dora@acme.test', companyId: big.companyId },
      app.scope.contacts,
    );
    app.actAs(viewer);
    const editor = await editContacts(
      `/admin/deals/${big.id}/relations/contacts`,
      app,
    );
    const added = await addLink(editor, 'Do', 'Dora');
    fireEvent.change(within(added).getByLabelText('Role'), {
      target: { value: 'other' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save links' }));
    await answer('Save links');
    expect(await within(editor).findByText('FORBIDDEN')).toBeTruthy();
    expect(
      within(editor).getAllByRole('group', { name: /^Link \d+$/ }).length,
    ).toBe(2);
    expect(within(editor).getByText('Dora')).toBeTruthy();
  });

  it('shows an issue at the links themselves in the alert', async () => {
    const { app, big } = await seeded();
    const editor = await editContacts(
      `/admin/deals/${big.id}/relations/contacts`,
      app,
    );
    app.answerNext(
      '/rpc/deals/contacts/set',
      Response.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION',
            message: 'The input is not valid',
            data: { issues: [{ path: ['links'], message: 'Too many links' }] },
          },
        },
        { status: 400 },
      ),
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Save links' }));
    await answer('Save links');
    expect(
      await within(editor).findByText(/links: Too many links/),
    ).toBeTruthy();
  });

  it('starts each relation’s tab over', async () => {
    const { app, big } = await seeded();
    await editContacts(`/admin/deals/${big.id}/relations/contacts`, app);
    fireEvent.click(screen.getByRole('link', { name: 'Partners' }));
    expect(
      await screen.findByRole('button', { name: 'Edit links' }),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Edit contacts' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit links' }));
    const partners = await screen.findByRole('form', { name: 'Edit partners' });
    fireEvent.click(
      within(partners).getByRole('button', { name: 'Save links' }),
    );
    await answer('Save links');
    await waitFor(() =>
      expect(app.sentTo('/rpc/deals/partners/set')).toEqual([
        { id: big.id, links: [] },
      ]),
    );
  });

  it('says so when a document has more links than one set takes', async () => {
    const { app, big } = await seeded();
    for (let index = 0; index < 1001; index++) {
      await app.repos.deal_contacts.insert(
        { dealsId: big.id, contactsId: `c${index}`, role: 'other' },
        app.scope.dealContacts,
      );
    }
    open(`/admin/deals/${big.id}/relations/contacts`, app.fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit links' }));
    expect(
      await screen.findByText(
        /more than 1000 contacts/,
        {},
        { timeout: 10_000 },
      ),
    ).toBeTruthy();
  }, 20_000);
});
