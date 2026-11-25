import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { ArchiveDeal } from '../../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../../app/use-cases/deals/close-deal.js';
import { CreateDeal } from '../../app/use-cases/deals/create-deal.js';
import { UpdateDeal } from '../../app/use-cases/deals/update-deal.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { Deals } from '../../domain/collections/deals.js';
import { Memberships } from '../../domain/collections/memberships.js';
import { Organizations } from '../../domain/collections/organizations.js';
import { clientErrors, toRpcError } from './errors.js';

/** Any signed-in caller may do this. The edge has already checked the actor. */
const anyone = () => true;

// An archived deal is hidden from every read and can no longer change.
const live = () => ({ archived: { eq: false } });

// A closed deal can no longer change either. Like an archived one, it
// answers update with NOT_FOUND. It closes through deals.close, which
// refuses a second close as AlreadyClosed.
const editable = () => ({
  archived: { eq: false },
  closedAt: { exists: false },
});

/** The CRM's API: five collections, three overrides and one method. No ports. */
export const crm = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError },
})
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Deals, {
    access: {
      read: live,
      create: anyone,
      update: editable,
      delete: live,
      close: live,
    },
    // A member sees every deal of the organization, without its amount.
    fields: {
      amount: {
        read: ({ actor }) => 'support' in actor || actor.role === 'manager',
      },
    },
    methods: { close: CloseDeal },
    // A deal closes only through deals.close: create and update refuse to.
    overrides: { create: CreateDeal, update: UpdateDeal, delete: ArchiveDeal },
  })
  .collection(Memberships, {
    // A member reads the memberships of the organization it acts in: its
    // team, for a team list or an owner picker. Support reads every one.
    // An organization switcher uses /auth organizations instead, since /rpc
    // needs an organization first. No create, update or delete: only
    // trusted code writes them.
    access: {
      read: ({ actor }) =>
        'support' in actor
          ? true
          : { organizationId: { eq: actor.organizationId } },
    },
  })
  .collection(Organizations, {
    // A member reads the organization it acts in, and support every one.
    // No create, update or delete: only trusted code writes them.
    access: {
      read: ({ actor }) =>
        'support' in actor ? true : { id: { eq: actor.organizationId } },
    },
  });

/** What clients and codegen import. */
export const contract = crm.contract;

export { AppUseCase, Companies, Contacts, Deals, Memberships, Organizations };
