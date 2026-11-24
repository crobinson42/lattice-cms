import type { CollectionStore } from '@latticecms/core';
import { MemoryDomainEvents } from '../infra/events/memory-domain-events.js';
import { api } from './rpc/contract.js';

// The publisher takes only the catalog's events, so a collection missing
// from the catalog does not compile here.
export function createApp(store: CollectionStore) {
  return api.build({ store, events: new MemoryDomainEvents() });
}
