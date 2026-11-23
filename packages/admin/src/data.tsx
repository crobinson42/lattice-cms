import type { Link } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { Procedure } from './catalog.js';
import type { Collection } from './collections.js';

const LinkContext = createContext<Link | undefined>(undefined);

/** Calls go to the catalog's prefix, through the app's fetch. */
export function LinkProvider({
  prefix,
  fetch,
  children,
}: {
  readonly prefix: string;
  readonly fetch: typeof globalThis.fetch;
  readonly children: ReactNode;
}) {
  const link = useMemo(
    () => new FetchLink({ url: prefix, fetch }),
    [prefix, fetch],
  );
  return <LinkContext value={link}>{children}</LinkContext>;
}

function useLink(): Link {
  const link = useContext(LinkContext);
  if (link === undefined) {
    throw new Error('Lattice admin: a call outside <Admin>');
  }
  return link;
}

/** An swr key: the procedure's path and its input. */
type Call = readonly [path: readonly string[], input: unknown];

/**
 * Calls `procedure` with `input` through swr, keyed by both, so the same
 * call is shared and refetched on focus. No procedure, no call.
 */
export function useCall(procedure: Procedure | undefined, input: unknown) {
  const link = useLink();
  const key: Call | null =
    procedure === undefined ? null : [procedure.path, input];
  return useSWR(key, ([path, body]: Call) => link.call([...path], body));
}

/** Calls a procedure once, outside swr: a write, or a load the user asked for. */
export function useCaller(): (
  procedure: Procedure,
  input: unknown,
) => Promise<unknown> {
  const link = useLink();
  return useCallback(
    (procedure, input) => link.call([...procedure.path], input),
    [link],
  );
}

/**
 * After a write: refetches every swr entry of the collections it touched,
 * by their procedures' paths, such as a document, its lists and counts, and
 * a relation's target.
 */
export function useRevalidate(): (
  ...collections: readonly Collection[]
) => Promise<void> {
  const { mutate } = useSWRConfig();
  return async (...collections) => {
    const paths = new Set(
      collections.flatMap(({ procedures }) =>
        procedures.map(({ path }) => path.join('/')),
      ),
    );
    await mutate(
      (key) =>
        Array.isArray(key) &&
        Array.isArray(key[0]) &&
        paths.has(key[0].join('/')),
    );
  };
}
