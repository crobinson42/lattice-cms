import {
  Queue,
  type QueueDisposition,
  type QueueMaxDeliveries,
  type QueueMessage,
  type QueuePublishOptions,
  type QueueRetryIn,
  type QueueSubscribeOptions,
  retryExhausted,
} from '@hexok/queue';
import { Adapter } from 'hexok';

/**
 * A handler as this queue stores it, whatever payload type it was
 * subscribed with. A method signature, so its parameter is bivariant: the
 * payload is the caller's, as a Redis adapter's decoded JSON is.
 */
type AnyHandler = {
  handle(
    message: QueueMessage<unknown>,
  ): Promise<QueueDisposition | QueueRetryIn<unknown> | void>;
}['handle'];

/** One entry waiting for a group, with its handoff count. */
type Entry = {
  readonly id: string;
  readonly payload: unknown;
  readonly deliveries: number;
};

/** One consumer group's subscription to a topic. */
type Subscription = {
  readonly topic: string;
  readonly group: string;
  readonly handler: AnyHandler;
  readonly maxDeliveries: QueueMaxDeliveries;
  readonly onError: QueueDisposition;
  readonly concurrency: number;
  readonly waiting: Entry[];
  running: number;
  stopped: boolean;
};

/**
 * The `@hexok/queue` port in memory, for the crm's tests. hexok ships no
 * memory queue, and webhooks need one that delays and retries. It follows
 * the port's rules as RedisQueue does: every group gets every entry
 * published after it subscribed, `'retry'` and a throw redeliver until
 * `maxDeliveries` and then give up, a retry result acks and republishes to
 * that group after `retryInMs`, `concurrency` caps running handlers, and
 * `stop` waits for running handlers. Entries live in this process only.
 */
export class MemoryQueue extends Adapter(Queue) {
  /** Every entry published, in order. */
  readonly published: { readonly topic: string; readonly payload: unknown }[] =
    [];
  /** Entries a group gave up on at `maxDeliveries`, as RedisQueue parks them. */
  readonly gaveUp: {
    readonly topic: string;
    readonly group: string;
    readonly payload: unknown;
  }[] = [];
  readonly #subscriptions: Subscription[] = [];
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #running = new Set<Promise<void>>();
  #ids = 0;

  async start(): Promise<void> {}

  override async publish(
    topic: string,
    payload: unknown,
    options: QueuePublishOptions = {},
  ): Promise<string> {
    // A copy, as a real queue carries JSON.
    const copy: unknown = JSON.parse(JSON.stringify(payload));
    const id = this.#nextId();
    this.published.push({ topic, payload: copy });
    this.#later(options.delayMs ?? 0, () => {
      for (const subscription of this.#subscriptions) {
        if (subscription.topic === topic) {
          this.#enqueue(subscription, { id, payload: copy, deliveries: 1 });
        }
      }
    });
    return id;
  }

  override async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    const handler: AnyHandler = options.handler;
    this.#subscriptions.push({
      topic,
      group: options.consumerGroup,
      handler,
      maxDeliveries: options.maxDeliveries,
      onError: options.onError ?? 'retry',
      concurrency: options.concurrency ?? 1,
      waiting: [],
      running: 0,
      stopped: false,
    });
  }

  override async unsubscribe(
    topic: string,
    options: { readonly consumerGroup: string },
  ): Promise<void> {
    for (const subscription of this.#subscriptions) {
      if (
        subscription.topic === topic &&
        subscription.group === options.consumerGroup
      ) {
        subscription.stopped = true;
      }
    }
    await this.#settled();
  }

  /** Stops delivering, and waits for every running handler, as RedisQueue does. */
  async stop(): Promise<void> {
    for (const subscription of this.#subscriptions) subscription.stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    await this.#settled();
  }

  /** Resolves once nothing is waiting, running or scheduled. For tests. */
  async idle(): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const busy =
        this.#timers.size > 0 ||
        this.#running.size > 0 ||
        this.#subscriptions.some(
          (subscription) =>
            !subscription.stopped && subscription.waiting.length > 0,
        );
      if (!busy) return;
    }
  }

  #nextId(): string {
    this.#ids += 1;
    return String(this.#ids);
  }

  #later(delayMs: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      run();
    }, delayMs);
    this.#timers.add(timer);
  }

  #enqueue(subscription: Subscription, entry: Entry): void {
    if (subscription.stopped) return;
    subscription.waiting.push(entry);
    this.#pump(subscription);
  }

  #pump(subscription: Subscription): void {
    while (
      !subscription.stopped &&
      subscription.running < subscription.concurrency
    ) {
      const entry = subscription.waiting.shift();
      if (entry === undefined) return;
      subscription.running += 1;
      const run = this.#deliver(subscription, entry).finally(() => {
        subscription.running -= 1;
        this.#running.delete(run);
        this.#pump(subscription);
      });
      this.#running.add(run);
    }
  }

  async #deliver(subscription: Subscription, entry: Entry): Promise<void> {
    let outcome: QueueDisposition | QueueRetryIn<unknown>;
    try {
      const returned = await subscription.handler({
        id: entry.id,
        topic: subscription.topic,
        payload: entry.payload,
        deliveries: entry.deliveries,
      });
      outcome = returned ?? 'ack';
    } catch {
      outcome = subscription.onError;
    }
    if (typeof outcome === 'object') {
      // Acked, and replaced for this group only, starting at delivery 1.
      const payload = outcome.payload ?? entry.payload;
      this.#later(outcome.retryInMs, () =>
        this.#enqueue(subscription, {
          id: this.#nextId(),
          payload,
          deliveries: 1,
        }),
      );
      return;
    }
    if (outcome !== 'retry') return;
    if (retryExhausted(entry.deliveries, subscription.maxDeliveries)) {
      this.gaveUp.push({
        topic: subscription.topic,
        group: subscription.group,
        payload: entry.payload,
      });
      return;
    }
    this.#enqueue(subscription, {
      ...entry,
      deliveries: entry.deliveries + 1,
    });
  }

  async #settled(): Promise<void> {
    while (this.#running.size > 0) await Promise.all(this.#running);
  }
}
