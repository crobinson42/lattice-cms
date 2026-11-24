import { EventCatalog } from 'hexok';
import { Companies } from '../collections/companies.js';
import { Contacts } from '../collections/contacts.js';

/** The app's one catalog. */
export class DomainEvents extends EventCatalog('domain-events', {
  companiesCreated: Companies.events.created,
  companiesUpdated: Companies.events.updated,
  companiesDeleted: Companies.events.deleted,
  contactsCreated: Contacts.events.created,
  contactsUpdated: Contacts.events.updated,
  contactsDeleted: Contacts.events.deleted,
  contactCompaniesCreated: Contacts.relations.companies.through.events.created,
  contactCompaniesUpdated: Contacts.relations.companies.through.events.updated,
  contactCompaniesDeleted: Contacts.relations.companies.through.events.deleted,
}) {}
