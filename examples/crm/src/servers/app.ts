import { type CollectionStore, framework } from '@latticecms/core';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import { AppUseCase } from '../app/use-cases/context.js';
import { ArchiveDeal } from '../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../app/use-cases/deals/close-deal.js';
import { Companies } from '../domain/collections/companies.js';
import { Contacts } from '../domain/collections/contacts.js';
import { Deals } from '../domain/collections/deals.js';
import { clientErrors, toRpcError } from './rpc/errors.js';

export { AppUseCase, Companies, Contacts, Deals };

export type AppPorts = {
  readonly store: CollectionStore;
  readonly events: DomainEventPublisher;
};

/**
 * The composition root: the collections, the override and the method on
 * the app's family, built into the contract, the implemented router, the
 * use cases and the repos.
 */
export function createApp(ports: AppPorts) {
  const lattice = framework({
    family: AppUseCase,
    store: ports.store,
    events: ports.events,
    errors: { declared: clientErrors, map: toRpcError },
  })
    .collection(Companies)
    .collection(Contacts)
    .collection(Deals, {
      methods: { close: CloseDeal },
      overrides: { delete: ArchiveDeal },
    });
  const deals = lattice.repo(Deals);
  const built = lattice.build({
    methods: {
      deals: { close: new CloseDeal({ deals, events: ports.events }) },
    },
    overrides: { deals: { delete: new ArchiveDeal({ deals }) } },
  });
  return { lattice, ...built };
}

export type CrmApp = ReturnType<typeof createApp>;

/** What a TypeScript client imports, as a type only. */
export type CrmContract = CrmApp['contract'];
