import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { organizationHeader } from '../servers/http/headers.js';
import type { As } from './http.js';

/**
 * An MCP client connected to the crm's `/mcp`, sent `as` someone, as a
 * client configured with a bearer token and an organization header is.
 * `fetch` is the crm's handler, or a running server's network fetch.
 */
export async function mcpClient(
  fetch: (request: Request) => Promise<Response>,
  as: As,
  url = 'http://localhost/mcp',
): Promise<Client> {
  const client = new Client(
    { name: 'crm-test', version: '1' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (as.token !== undefined) {
          headers.set('authorization', `Bearer ${as.token}`);
        }
        if (as.org !== undefined) headers.set(organizationHeader, as.org);
        return fetch(new Request(input, { ...init, headers }));
      },
    }),
  );
  return client;
}

/** The text of a tool result: ts-pf sends one text block. */
export function textOf(result: { readonly content?: unknown }): string {
  const { content } = result;
  if (!Array.isArray(content)) throw new Error('no content');
  const [block]: unknown[] = content;
  if (
    typeof block !== 'object' ||
    block === null ||
    !('text' in block) ||
    typeof block.text !== 'string'
  ) {
    throw new Error('no text block');
  }
  return block.text;
}
