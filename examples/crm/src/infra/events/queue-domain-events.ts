import type { Queue } from '@hexok/queue';
import { Adapter, type EventInstance } from 'hexok';
import { DomainEventPublisher } from '../../app/ports/events/domain-event-publisher.js';
import { DomainEvents } from '../../domain/events/domain-events.js';

/**
 * Publishes each domain event to the queue, on a topic named by its token,
 * as app-template's adapter does. It rejects an event the catalog lacks.
 * The worker consumes the topics; another product never does (0010).
 */
export class QueueDomainEventPublisher extends Adapter(DomainEventPublisher) {
  constructor(private readonly deps: { readonly queue: Queue }) {
    super();
  }

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    const { payload } = DomainEvents.message(event);
    await this.deps.queue.publish(event.token, payload);
  }
}
