import { EventCatalog } from 'hexok';
import { Companies } from '../collections/companies.js';
import { Contacts } from '../collections/contacts.js';
import { Deals } from '../collections/deals.js';
import { Memberships } from '../collections/memberships.js';
import { DealClosedEvent } from './deal-closed.js';

/** Facts the API records and a worker would handle: the app's one catalog. */
export class DomainEvents extends EventCatalog('domain-events', {
  companiesCreated: Companies.events.created,
  companiesUpdated: Companies.events.updated,
  companiesDeleted: Companies.events.deleted,
  contactsCreated: Contacts.events.created,
  contactsUpdated: Contacts.events.updated,
  contactsDeleted: Contacts.events.deleted,
  dealsCreated: Deals.events.created,
  dealsUpdated: Deals.events.updated,
  dealsDeleted: Deals.events.deleted,
  membershipsCreated: Memberships.events.created,
  membershipsUpdated: Memberships.events.updated,
  membershipsDeleted: Memberships.events.deleted,
  dealClosed: DealClosedEvent,
}) {}
