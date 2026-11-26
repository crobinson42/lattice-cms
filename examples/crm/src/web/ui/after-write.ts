import { toast } from '@shadalaya/react/toast';
import type { SwrMatcher } from '@ts-pf/swr';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { useLocation } from 'wouter';
import { useLists } from '../api.js';

/**
 * What follows a successful write: it says so in a toast, and makes the
 * reads it changed fresh. `changed` picks the collection's reads, such as
 * `swr.deals.matcher()`.
 * - A list that is not on screen loses its cache, so it starts empty and
 *   reads fresh when it opens, rather than showing a deleted row.
 * - Staying on the page, its reads and its lists revalidate in place.
 * - With `goTo`, the page is left: its changed reads are dropped first, so
 *   the next page, its count too, reads them fresh, and then it navigates.
 */
export function useAfterWrite() {
  const { mutate } = useSWRConfig();
  const lists = useLists();
  const [, navigate] = useLocation();
  return useCallback(
    ({
      changed,
      says,
      goTo,
    }: {
      readonly changed: SwrMatcher;
      readonly says: string;
      readonly goTo?: string;
    }) => {
      toast.add({ title: says, type: 'success' });
      // A list keyed by unstable_serialize is reset through mutate, which
      // also clears SWR's dedupe of its last request: one that is not on
      // screen starts empty, so it never shows a row the write removed.
      for (const key of lists.known) {
        if (!lists.mounted.has(key) || goTo !== undefined) {
          void mutate(key, undefined);
        }
      }
      if (goTo === undefined) {
        void mutate(changed);
        for (const refresh of lists.mounted.values()) refresh();
        return;
      }
      // Clearing the data, with a revalidation, also clears SWR's dedupe of
      // the last request: the next page's reads fetch fresh, and none shows
      // what the write changed.
      void mutate(changed, undefined);
      navigate(goTo);
    },
    [mutate, lists, navigate],
  );
}
