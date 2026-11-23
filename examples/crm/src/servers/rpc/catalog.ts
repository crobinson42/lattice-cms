import { catalog } from '@ts-pf/docs';
import { contract } from './contract.js';

/**
 * The API at `/rpc` as ts-pf's catalog: every procedure's schemas and meta,
 * with the facts Lattice writes into them (0033). The admin builds its views
 * from it, and the OpenAPI document is projected from it.
 */
export function catalogDocument() {
  return catalog(contract, { prefix: '/rpc' });
}
