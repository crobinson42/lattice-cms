import {
  Adapter,
  Event,
  EventCatalog,
  type EventInstance,
  type EventMessage,
  Port,
} from 'hexok';
import { z } from 'zod';
import { Comments } from './comments.js';
import { Posts } from './posts.js';

/** A hand-written event, next to the generated ones. */
export class PostPublishedEvent extends Event(
  'post.published',
  z.object({ postId: z.string(), actorId: z.string() }),
) {}

/** The app's one domain catalog, as app-template declares it. */
export class AppEvents extends EventCatalog('domain-events', {
  postsCreated: Posts.events.created,
  postsUpdated: Posts.events.updated,
  postsDeleted: Posts.events.deleted,
  commentsCreated: Comments.events.created,
  commentsUpdated: Comments.events.updated,
  commentsDeleted: Comments.events.deleted,
  postPublished: PostPublishedEvent,
}) {}

/** app-template's `DomainEventPublisher` port, unchanged. */
export abstract class DomainEventPublisher extends Port(
  'DomainEventPublisher',
) {
  abstract publish(event: EventInstance<typeof AppEvents>): Promise<void>;
}

/**
 * The publisher adapter tests use. Like app-template's queue adapter, it
 * converts each event with `AppEvents.message`, which throws for an event
 * the catalog lacks.
 */
export class MemoryEventPublisher extends Adapter(DomainEventPublisher) {
  readonly messages: EventMessage<typeof AppEvents>[] = [];

  override async publish(
    event: EventInstance<typeof AppEvents>,
  ): Promise<void> {
    this.messages.push(AppEvents.message(event));
  }
}

/** The publisher of an app with no subscribers. */
export const noSubscribers = {
  async publish(_event: unknown): Promise<void> {},
};
