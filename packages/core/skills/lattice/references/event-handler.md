# Event handler

Generated writes publish the collection's events: `Deals.events.created`, `.updated` and `.deleted`, with tokens `deals.created` and so on. Payloads are `{ doc, actorId }`, plus `previous` on update and `tenantId` on a tenanted collection. Overrides and methods publish their own events. Work that follows an event is a hexok `EventHandler`.

Read hexok's skill (`references/event-handler.md`) for the primitive. This file covers what Lattice adds.

## The catalog

The app lists every collection's events in its one catalog, next to its own:

```ts
// examples/crm/src/domain/events/domain-events.ts
  dealContactsCreated: Deals.relations.contacts.through.events.created,
  dealContactsUpdated: Deals.relations.contacts.through.events.updated,
  dealContactsDeleted: Deals.relations.contacts.through.events.deleted,
  dealClosed: DealClosedEvent,
}) {}
```

`build({ events })` takes the app's publisher. It must take every collection's events, or `build()` does not compile.

## A handler is system code

A handler acts for no caller. It reads inside the event's own tenant with `tenancy.scope`, never with an actor's access. The crm's handlers follow `DealClosedEvent`, which `deals.close` publishes with its tenant:

```ts
// examples/crm/src/app/event-handlers/deal-closed-webhook.ts
export class SendDealClosedWebhook extends EventHandler(
  'deals.send-closed-webhook',
  DealClosedEvent,
) {
```

```ts
// examples/crm/src/app/event-handlers/deal-closed-webhook.ts
  async handle(event: DealClosedEvent): Promise<void> {
    const { dealId, outcome, tenantId } = event.payload;
    const deal = await this.deps.deals.get(
      dealId,
      tenancy.scope(Deals, tenantId),
    );
```

The crm has no handler on a collection event. One is written the same way: `EventHandler(token, Deals.events.updated)`, with `event.payload.tenantId` for its scope and `event.payload.doc` for the stored document.

## What leaves the product

A collection event stays inside the product. Another product or a customer gets a mapping of its own, made in a handler:

- an integration event, through `@hexok/integration-events`, with a versioned contract;
- a webhook, through `@hexok/webhooks`, with its own catalog.

The mapping copies field by field, so a new internal field reaches no one outside:

```ts
// examples/crm/src/app/event-handlers/deal-closed-webhook.ts
export function dealClosedWebhook(
  deal: Doc<typeof Deals>,
  outcome: 'won' | 'lost',
  closedAt: string,
): DealClosedWebhook['payload'] {
  return {
    dealId: deal.id,
    companyId: deal.companyId,
    title: deal.title,
    outcome,
    closedAt,
  };
}
```

Events carry whole documents, masked fields included. The mapping decides what leaves. The crm's webhook leaves out `amount`; its integration event carries it, inside the company.

Each handler subscribes in the worker in its own consumer group. Delivery is at least once: use a stable id, such as `deal.closed:<id>`, so a consumer dedupes. The crm's worker is `src/servers/worker/`; core's README section "A worker: webhooks and integration events" walks it.

## Do not

- Do not send a collection event to another product or a customer. Map it.
- Do not read with `unscoped` in a handler. Use `tenancy.scope(C, event.payload.tenantId)`.
- Do not block a write in a handler. A rule that refuses a write belongs in an override.
- Do not subscribe by pattern. A handler names its event class.
- Do not expect read events. Reads publish nothing.

## Errors you will see

- `build()` does not compile when the publisher refuses an event: `'~error'` reads `the events publisher does not take "deals.created"`.
- `tenancy.scope` takes only a tenanted collection. A global one is a type error, and throws `"organizations" has no tenant field`.
- A publish failure after a generated write reaches the caller, and the write stays. There is no outbox yet.
