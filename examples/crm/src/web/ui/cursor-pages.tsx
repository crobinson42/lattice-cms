import { Button } from '@shadalaya/react/button';
import type { SwrKey } from '@ts-pf/swr';
import { useEffect, useRef, useState } from 'react';
import useSWRInfinite, { unstable_serialize } from 'swr/infinite';
import { useLists } from '../api.js';
import { ErrorState } from './states.js';

/** A page of a `find`: its documents, and the cursor to the next page. */
type Page<Row> = {
  readonly docs: readonly Row[];
  readonly next: string | null;
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
 * A `find` read a page at a time, on its `next` cursor: `key` is its swr
 * key, and `read` calls it. A read that populates passes its literal
 * `populate` in `read`, which is what narrows the rows' type, and in
 * `input` too, so the cache key says so. `refresh()` revalidates every
 * loaded page now: a write while the list is mounted calls it. `firstNew`
 * is the index of the first row the last "load more" added, for focus.
 */
export function useCursorPages<
  I extends { readonly after?: string | undefined },
  Row,
>(
  key: (options: { input: I }) => SwrKey<I>,
  // The input comes from `key`: a literal here is checked against it.
  input: NoInfer<I>,
  read: (input: I) => Promise<Page<Row>>,
): CursorPages<Row> {
  // Each page's key holds its input, so the fetcher reads it back typed.
  const pageKey = (page: I): readonly [SwrKey<I>, I] => [
    key({ input: page }),
    page,
  ];
  const getKey = (_index: number, previous: Page<Row> | null) => {
    if (previous === null) return pageKey(input);
    if (previous.next === null) return null;
    return pageKey({ ...input, after: previous.next });
  };
  // Every loaded page revalidates together, so a refresh never leaves a
  // stale page behind the first.
  const pages = useSWRInfinite(getKey, ([, page]) => read(page), {
    revalidateAll: true,
  });
  // A write finds this list by its key: to refresh it while it is on
  // screen, or to reset it once it is not (useAfterWrite).
  const lists = useLists();
  const cacheKey = unstable_serialize(getKey);
  const refresh = useRef(pages.mutate);
  refresh.current = pages.mutate;
  useEffect(() => {
    lists.known.add(cacheKey);
    lists.mounted.set(cacheKey, () => void refresh.current());
    return () => {
      lists.mounted.delete(cacheKey);
    };
  }, [lists, cacheKey]);
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
