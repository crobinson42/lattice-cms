import { type EventInstance, Port } from 'hexok';
import type { DomainEvents } from '../../../domain/events/domain-events.js';

/** Publishes the app's domain events, generated and hand-written alike. */
export abstract class DomainEventPublisher extends Port(
  'DomainEventPublisher',
) {
  abstract publish(event: EventInstance<typeof DomainEvents>): Promise<void>;
}
