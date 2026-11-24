import type { EventInstance } from 'hexok';
import type { DomainEvents } from '../../domain/events/domain-events.js';

/** Keeps what it publishes. It takes only the catalog's events. */
export class MemoryDomainEvents {
  readonly published: EventInstance<typeof DomainEvents>[] = [];

  async publish(event: EventInstance<typeof DomainEvents>): Promise<void> {
    this.published.push(event);
  }
}
