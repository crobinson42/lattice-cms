import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { createSwr } from '@ts-pf/swr';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { SWRConfig } from 'swr';
// Types only: the contract's module imports server code, which never
// reaches the browser (bundle.test.ts checks).
import type { contract } from '../servers/rpc/contract.js';

/**
 * The crm's clients over one fetch: the API at `/rpc`, and its swr utils
 * (keys, fetchers and mutators for useSWR). Pages read them with useApi()
 * and never build a client.
 */
function clientsFor(fetch: typeof globalThis.fetch) {
  const rpc = createClient<typeof contract>(
    new FetchLink({ url: '/rpc', fetch }),
  );
  return {
    /** The session's fetch, for what takes one, such as the admin. */
    fetch,
    rpc,
    swr: createSwr(rpc),
  };
}

export type Api = ReturnType<typeof clientsFor>;

const ApiContext = createContext<Api | null>(null);

/** The clients of the signed-in session, in the picked organization. */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi() outside <ApiProvider>');
  return api;
}

/**
 * The clients over `fetch`, and an swr cache of the organization's own: a
 * switch mounts a new cache, so no page shows the last organization's data.
 */
export function ApiProvider({
  fetch,
  organizationId,
  children,
}: {
  readonly fetch: typeof globalThis.fetch;
  readonly organizationId: string | undefined;
  readonly children: ReactNode;
}) {
  const api = useMemo(() => clientsFor(fetch), [fetch]);
  return (
    <ApiContext value={api}>
      <SWRConfig
        key={organizationId ?? 'support'}
        value={{ provider: () => new Map() }}
      >
        {children}
      </SWRConfig>
    </ApiContext>
  );
}
