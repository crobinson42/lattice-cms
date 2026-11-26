import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import type { ClientError, InferContractProcedure } from '@ts-pf/contract';
import { isPFError } from '@ts-pf/protocol';
import { createSwr } from '@ts-pf/swr';
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
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

type AnyProcedure = InferContractProcedure<
  (typeof contract)['companies']['get']
>;

/**
 * How a call can be refused, typed as the client types it: Lattice's and
 * the app's declared errors, and the protocol's, VALIDATION among them.
 * Every procedure declares the same errors, so one type serves them all.
 * It names a procedure because InferContractErrors leaves the protocol's
 * errors out in ts-pf 1.0.1 (docs/briefs/ts-pf-infer-contract-errors.md);
 * once that is fixed, it can come from there.
 */
export type ApiError = ClientError<AnyProcedure['errors']>;

const ApiContext = createContext<Api | null>(null);

/** The clients of the signed-in session, in the picked organization. */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi() outside <ApiProvider>');
  return api;
}

/**
 * Whether a failed read is worth retrying. A refusal, such as NOT_FOUND, is
 * the answer: asking again gets it again.
 */
function retryable(error: unknown): boolean {
  return !(
    isPFError(error) &&
    error.status !== undefined &&
    error.status < 500
  );
}

/**
 * The clients over `fetch`, and an swr cache of the organization's own: a
 * switch mounts a new cache, so no page shows the last organization's data.
 * Revalidate with `useSWRConfig().mutate`, which works on this cache: the
 * `mutate` that `swr` exports works on SWR's default cache, unused here.
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
        value={{ provider: () => new Map(), shouldRetryOnError: retryable }}
      >
        <ListsProvider>{children}</ListsProvider>
      </SWRConfig>
    </ApiContext>
  );
}

/**
 * The lists a page a time reads have shown in this organization, by the
 * key SWR caches them under (`unstable_serialize`), and how to refresh
 * each one on screen. A write uses it: SWR's filter `mutate` never reaches
 * these lists.
 */
export type Lists = {
  readonly known: Set<string>;
  readonly mounted: Map<string, () => void>;
};

const ListsContext = createContext<Lists | null>(null);

// Inside the organization's SWRConfig, so a switch starts a new set.
function ListsProvider({ children }: { readonly children: ReactNode }) {
  const [lists] = useState(
    (): Lists => ({ known: new Set(), mounted: new Map() }),
  );
  return <ListsContext value={lists}>{children}</ListsContext>;
}

export function useLists(): Lists {
  const lists = useContext(ListsContext);
  if (lists === null) throw new Error('useLists() outside <ApiProvider>');
  return lists;
}
