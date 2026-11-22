import type { Logger } from '@hexok/logger';
import type { Queue, QueueMaxDeliveries } from '@hexok/queue';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { CodedError } from 'hexok';

/** The worker's tracer: the job spans around each handled event. */
const tracer = trace.getTracer('crm-worker');

/** One event handler, as a hexok `EventHandler` instance is. */
export type QueueEventHandler<E> = {
  readonly token: string;
  readonly event: { readonly token: string; parse(value: unknown): E };
  handle(event: E): Promise<void> | void;
};

/**
 * Subscribes `handler` to its event's topic, the event token, in its own
 * consumer group, `crm:<handler token>`, so each handler gets every event.
 * Each delivery runs in a job span, active while it runs, so the handler's
 * store spans nest under it. A payload the event schema rejects is logged
 * and dropped: a redelivery would fail the same way. A throw from `handle`
 * is left to the queue, which retries up to `maxDeliveries`.
 */
export async function subscribeHandler<E>(
  queue: Queue,
  handler: QueueEventHandler<E>,
  options: {
    readonly maxDeliveries: QueueMaxDeliveries;
    readonly logger: Logger;
  },
): Promise<{ readonly topic: string; readonly group: string }> {
  const topic = handler.event.token;
  const group = `crm:${handler.token}`;
  await queue.subscribe(topic, {
    consumerGroup: group,
    maxDeliveries: options.maxDeliveries,
    handler: (message) =>
      tracer.startActiveSpan(
        `process ${topic}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'hexok.queue',
            'messaging.operation.type': 'process',
            'messaging.operation.name': 'process',
            'messaging.destination.name': topic,
            'messaging.consumer.group.name': group,
            'messaging.message.id': message.id,
            'hexok.queue.deliveries': message.deliveries,
          },
        },
        async (span) => {
          try {
            let event: E;
            try {
              event = handler.event.parse(message.payload);
            } catch (error) {
              if (!(error instanceof CodedError)) throw error;
              options.logger.warn('event dropped', {
                topic,
                group,
                id: message.id,
                code: error.code,
              });
              span.setAttribute('hexok.queue.outcome', 'dropped');
              return 'drop';
            }
            await handler.handle(event);
            span.setAttribute('hexok.queue.outcome', 'ok');
            return 'ack';
          } catch (error) {
            // No exception event: a handler's error can quote a document.
            span.setAttributes({
              'hexok.queue.outcome': 'failed',
              'error.type': error instanceof Error ? error.name : typeof error,
            });
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      ),
  });
  return { topic, group };
}
