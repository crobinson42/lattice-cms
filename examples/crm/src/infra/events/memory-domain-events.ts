import { Adapter, type EventInstance, type EventMessage } from 'hexok';
import { DomainEventPublisher } from '../../app/ports/events/domain-event-publisher.js';
import { DomainEvents } from '../../domain/events/domain-events.js';

/** Keeps each event's message, for tests. Rejects an event the catalog lacks. */
export class MemoryDomainEventPublisher extends Adapter(DomainEventPublisher) {
  readonly messages: EventMessage<typeof DomainEvents>[] = [];

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    this.messages.push(DomainEvents.message(event));
  }
}
