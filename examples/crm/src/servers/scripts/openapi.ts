import { writeFileSync } from 'node:fs';
import { openapiDocument } from '../rpc/openapi.js';

/**
 * Writes the API's OpenAPI document to `openapi.json`, for a code
 * generator. No store or server: the document comes from the contract.
 *
 * npm run openapi -w @latticecms/example-crm
 */
writeFileSync(
  'openapi.json',
  `${JSON.stringify(openapiDocument(), null, 2)}\n`,
);
console.log('wrote openapi.json');
