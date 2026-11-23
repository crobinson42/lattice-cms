import { catalog } from '@ts-pf/docs';
import { openapi } from '@ts-pf/openapi';
import { contract } from './contract.js';

/**
 * The API at `/rpc` as an OpenAPI 3.1 document, shaped for code generators
 * in other languages. Only the contract is in it: the `/auth` router is a
 * separate router, so login and its collections never appear.
 */
export function openapiDocument() {
  return openapi(catalog(contract, { prefix: '/rpc' }), {
    info: { title: 'Lattice CRM', version: '0.0.0' },
    profile: 'codegen',
  });
}
