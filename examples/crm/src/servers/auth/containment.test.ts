import { MemoryStore } from '@latticecms/core';
import { isContractProcedure } from '@ts-pf/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { credentialsCollection } from '../../infra/auth/store-credentials.js';
import { loginAttemptsCollection } from '../../infra/auth/store-login-attempts.js';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { createApp } from '../app.js';
import { contract } from '../rpc/contract.js';
import { authContract } from './contract.js';

/** Every procedure's output schema, as JSON Schema text, by path. */
function outputs(node: unknown, path: string[] = []): [string, string][] {
  if (isContractProcedure(node)) {
    const { output } = node['~pf'];
    return output instanceof z.ZodType
      ? [
          [
            path.join('.'),
            JSON.stringify(z.toJSONSchema(output, { unrepresentable: 'any' })),
          ],
        ]
      : [];
  }
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, child]) =>
    outputs(child, [...path, key]),
  );
}

describe('password hashes stay out of every API', () => {
  it('no Lattice collection, slice or repo uses the credentials or attempts collections', () => {
    const { repos } = createApp({
      store: new MemoryStore(),
      events: new MemoryDomainEventPublisher(),
    });
    for (const slug of [credentialsCollection, loginAttemptsCollection]) {
      expect(Object.keys(contract)).not.toContain(slug);
      expect(Object.keys(repos)).not.toContain(slug);
    }
  });

  it('no procedure of either router outputs a hash', () => {
    const all = [...outputs(contract), ...outputs(authContract)];

    // Every procedure was read, so the check covers them all.
    expect(all.map(([path]) => path)).toContain('login');
    expect(all.map(([path]) => path)).toContain('deals.find');
    for (const [path, schema] of all) {
      expect(schema, path).not.toContain('"hash"');
    }
  });
});
