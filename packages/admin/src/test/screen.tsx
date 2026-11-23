import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Admin } from '../index.js';
import { adminApp } from './app.js';

type Options = { readonly basePath?: string; readonly header?: ReactNode };

export function admin(fetch: typeof globalThis.fetch, options: Options = {}) {
  return (
    <Admin
      fetch={fetch}
      catalogUrl="/catalog.json"
      basePath={options.basePath ?? '/admin'}
      header={options.header}
    />
  );
}

export function open(
  path: string,
  fetch: typeof globalThis.fetch,
  options?: Options,
) {
  window.history.replaceState(null, '', path);
  return render(admin(fetch, options));
}

/** An app with two companies, a contact, and deals that refer to them. */
export async function seeded() {
  const app = adminApp();
  const { companies, contacts, deals } = app.repos;
  const acme = await companies.insert({ name: 'Acme' }, app.scope.companies);
  const hidden = await companies.insert(
    { name: 'Hidden' },
    app.scope.companies,
  );
  const cara = await contacts.insert(
    { name: 'Cara', email: 'cara@acme.test', companyId: acme.id },
    app.scope.contacts,
  );
  const big = await deals.insert(
    { title: 'B deal', companyId: acme.id, amount: 4242.5, stage: 'won' },
    app.scope.deals,
  );
  await deals.insert(
    { title: 'A deal', companyId: acme.id, amount: 10 },
    app.scope.deals,
  );
  const secret = await deals.insert(
    { title: 'C deal', companyId: hidden.id, amount: 20 },
    app.scope.deals,
  );
  await app.repos.deal_contacts.insert(
    { dealsId: big.id, contactsId: cara.id, role: 'champion' },
    app.scope.dealContacts,
  );
  return { app, acme, big, cara, secret };
}

/** The text of each body row's first cell. */
export function firstCells(): string[] {
  const [, body] = screen.getAllByRole('rowgroup');
  if (body === undefined) return [];
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
}
