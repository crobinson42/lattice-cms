import { describe, expect, it } from 'vitest';
// The definition module alone: no store, no publisher, no wiring.
import { contract, crm } from './contract.js';

describe('the contract module', () => {
  it('gives the contract with no ports', () => {
    expect(Object.keys(contract)).toEqual(['companies', 'contacts', 'deals']);
    expect(Object.keys(contract.deals)).toEqual([
      'find',
      'count',
      'get',
      'create',
      'update',
      'delete',
      'close',
    ]);
  });

  it('is the same object on every read', () => {
    expect(crm.contract).toBe(contract);
    expect(crm.contract).toBe(crm.contract);
  });
});
