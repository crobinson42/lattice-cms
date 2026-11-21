import type { Logger } from '@hexok/logger';
import { Adapter, type EventInstance } from 'hexok';
import { DomainEventPublisher } from '../../app/ports/events/domain-event-publisher.js';
import { DomainEvents } from '../../domain/events/domain-events.js';

/**
 * Phase 0 has no queue, so the server logs each event instead. Like
 * app-template's queue adapter, it rejects an event the catalog lacks.
 */
export class LoggingDomainEventPublisher extends Adapter(DomainEventPublisher) {
  constructor(private readonly deps: { logger: Logger }) {
    super();
  }

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    const { key } = DomainEvents.message(event);
    this.deps.logger.info('domain event', { token: event.token, key });
  }
}
