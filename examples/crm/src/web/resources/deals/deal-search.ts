import { useCallback } from 'react';
import { useApi } from '../../api.js';
import { dealTitleSearch } from './deal.js';
import type { DealOption } from './deal-select.js';

/**
 * The search DealSelect takes, over the API: the first 20 deals whose
 * title contains the query, by title. Archived deals are not read. `signal`
 * cancels a search the user has typed past.
 */
export function useDealSearch() {
  const { swr } = useApi();
  return useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly DealOption[]> => {
      const { docs } = await swr.deals.find(
        { where: dealTitleSearch(query), sort: ['title'], limit: 20 },
        { signal },
      );
      return docs;
    },
    [swr],
  );
}
