import { useCallback } from 'react';
import { useApi } from '../../api.js';
import { dealTitleSearch } from './deal.js';
import type { DealOption } from './deal-select.js';

/**
 * The search DealSelect and the search palette take, over the API: the
 * first `limit` deals whose title contains the query, by title, each with
 * its company. Archived deals are not read. `signal`
 * cancels a search the user has typed past.
 */
export function useDealSearch(limit: number) {
  const { swr } = useApi();
  return useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly DealOption[]> => {
      const { docs } = await swr.deals.find(
        {
          where: dealTitleSearch(query),
          sort: ['title'],
          limit,
          populate: ['companyId'],
        },
        { signal },
      );
      return docs;
    },
    [swr, limit],
  );
}
