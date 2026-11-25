import type { CollectionStore } from '@latticecms/core';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import { ArchiveDeal } from '../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../app/use-cases/deals/close-deal.js';
import { CreateDeal } from '../app/use-cases/deals/create-deal.js';
import { UpdateDeal } from '../app/use-cases/deals/update-deal.js';
import { crm } from './rpc/contract.js';

export type AppPorts = {
  readonly store: CollectionStore;
  readonly events: DomainEventPublisher;
};

/** The implemented router, use cases and repos over these ports. */
export function createApp({ store, events }: AppPorts) {
  return crm.build({
    store,
    events,
    methods: ({ repos }) => ({
      deals: { close: new CloseDeal({ deals: repos.deals, events }) },
    }),
    overrides: ({ repos, generated }) => ({
      deals: {
        create: new CreateDeal({ create: generated.deals.create }),
        update: new UpdateDeal({ update: generated.deals.update }),
        delete: new ArchiveDeal({ deals: repos.deals }),
      },
    }),
  });
}

export type CrmApp = ReturnType<typeof createApp>;
