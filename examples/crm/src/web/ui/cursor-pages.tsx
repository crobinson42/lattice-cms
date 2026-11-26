import { Button } from '@shadalaya/react/button';
import type { SwrFetcher, SwrKey } from '@ts-pf/swr';
import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { ErrorState } from './states.js';

/** A `find` procedure's swr utils: what useCursorPages reads with. */
type Find<I, P> = {
  readonly key: (options: { input: I }) => SwrKey<I>;
  readonly fetcher: () => SwrFetcher<I, P>;
};

/** A list read a page at a time: what useCursorPages returns. */
export type CursorPages<Row = unknown> = {
  readonly rows: readonly Row[] | undefined;
  readonly error: unknown;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly firstNew: number | undefined;
  readonly loadMore: () => void;
  readonly refresh: () => void;
};

/**
 * A `find` read a page at a time, on its `next` cursor. `refresh()`
 * revalidates every loaded page now: a write while the list is mounted
 * calls it. `firstNew` is the index of the first row the last "load more"
 * added, for focus.
 */
export function useCursorPages<
  I extends { readonly after?: string | undefined },
  Row,
>(
  find: Find<
    I,
    { readonly docs: readonly Row[]; readonly next: string | null }
  >,
  // The input comes from `find`: a literal here is checked against it.
  input: NoInfer<I>,
): CursorPages<Row> {
  const pages = useSWRInfinite(
    (_index, previous) => {
      if (previous === null) return find.key({ input });
      if (previous.next === null) return null;
      return find.key({ input: { ...input, after: previous.next } });
    },
    find.fetcher(),
    // Every loaded page revalidates together, and a list that opens again
    // reads again at once, even right after it closed: a write on another
    // page cannot reach this cache, since SWR's filter mutate skips
    // infinite keys.
    { revalidateAll: true, dedupingInterval: 0 },
  );
  const [firstNew, setFirstNew] = useState<number>();
  const rows = pages.data?.flatMap(({ docs }) => docs);
  return {
    rows,
    error: pages.error,
    hasMore: pages.data !== undefined && pages.data.at(-1)?.next !== null,
    // Asked for a page that has not arrived yet.
    loadingMore: pages.isValidating && pages.size > (pages.data?.length ?? 0),
    firstNew,
    loadMore: () => {
      setFirstNew(rows?.length);
      void pages.setSize(pages.size + 1);
    },
    refresh: () => void pages.mutate(),
  };
}

/** The "Load more" button under a list, and a failed page's retry. */
export function LoadMore({
  pages,
  what,
}: {
  readonly pages: Pick<
    CursorPages,
    'error' | 'hasMore' | 'loadingMore' | 'loadMore' | 'refresh'
  >;
  /** What the list holds, for the failure message: "companies". */
  readonly what: string;
}) {
  return (
    <>
      {pages.error === undefined ? null : (
        <ErrorState
          message={`The next ${what} could not be loaded.`}
          onRetry={pages.refresh}
        />
      )}
      {pages.hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            disabled={pages.loadingMore}
            onClick={pages.loadMore}
          >
            {pages.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
