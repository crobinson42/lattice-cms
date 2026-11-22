import { describe, expect, it } from 'vitest';
import {
  ConfigWebhookEndpoints,
  configuredEndpoints,
} from './config-endpoints.js';

const one = {
  organizationId: 'org-a',
  id: 'ep1',
  url: 'https://hooks.example.com/crm',
  secrets: ['whsec_c2VjcmV0'],
  events: ['deal.closed'],
};

describe('webhook endpoints from config', () => {
  it('reads a JSON list, none when unset, and refuses a bad one', () => {
    expect(configuredEndpoints(JSON.stringify([one]))).toEqual([one]);
    expect(configuredEndpoints(undefined)).toEqual([]);
    expect(configuredEndpoints('  ')).toEqual([]);
    expect(() =>
      configuredEndpoints(JSON.stringify([{ ...one, secrets: ['plain'] }])),
    ).toThrow();
  });

  it('gives an organization only its own endpoints, for the events they list', async () => {
    const endpoints = new ConfigWebhookEndpoints([one]);

    expect(await endpoints.subscribed('org-a', 'deal.closed')).toEqual([
      { id: 'ep1', url: one.url, secrets: one.secrets },
    ]);
    expect(await endpoints.subscribed('org-b', 'deal.closed')).toEqual([]);
    expect(await endpoints.subscribed('org-a', 'deal.lost')).toEqual([]);
    expect(await endpoints.get('org-b', 'ep1')).toBeNull();
  });
});
