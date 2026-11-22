import { type WebhookEndpoint, WebhookEndpoints } from '@hexok/webhooks';
import { Adapter } from 'hexok';
import { z } from 'zod';

/** One configured endpoint: whose it is, where it goes, and what it gets. */
const endpointSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  url: z.url(),
  /** `whsec_` secrets, newest first. */
  secrets: z.array(z.string().startsWith('whsec_')).min(1),
  /** The webhook event tokens it receives, such as `deal.closed`. */
  events: z.array(z.string().min(1)).min(1),
});

export type ConfiguredEndpoint = z.output<typeof endpointSchema>;

/**
 * Webhook endpoints from config, the least the sender needs: no admin UI and
 * no store. A change needs a restart. `CRM_WEBHOOK_ENDPOINTS` is a JSON list
 * of `{ organizationId, id, url, secrets, events }`.
 */
export class ConfigWebhookEndpoints extends Adapter(WebhookEndpoints) {
  constructor(private readonly endpoints: readonly ConfiguredEndpoint[]) {
    super();
  }

  override async subscribed(
    organizationId: string,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    return this.endpoints
      .filter(
        (endpoint) =>
          endpoint.organizationId === organizationId &&
          endpoint.events.includes(eventType),
      )
      .map(toEndpoint);
  }

  override async get(
    organizationId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint | null> {
    const found = this.endpoints.find(
      (endpoint) =>
        endpoint.organizationId === organizationId &&
        endpoint.id === endpointId,
    );
    return found === undefined ? null : toEndpoint(found);
  }
}

function toEndpoint(endpoint: ConfiguredEndpoint): WebhookEndpoint {
  return { id: endpoint.id, url: endpoint.url, secrets: endpoint.secrets };
}

/** The endpoints in `CRM_WEBHOOK_ENDPOINTS`, or none. Throws on a bad list. */
export function configuredEndpoints(
  value: string | undefined,
): ConfiguredEndpoint[] {
  if (value === undefined || value.trim() === '') return [];
  return z.array(endpointSchema).parse(JSON.parse(value));
}
