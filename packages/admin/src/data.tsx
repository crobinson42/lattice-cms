import type { Link } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import useSWR from 'swr';
import type { Procedure } from './catalog.js';

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
