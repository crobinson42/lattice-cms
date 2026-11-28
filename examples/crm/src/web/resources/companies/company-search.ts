import { useCallback } from 'react';
import { useApi } from '../../api.js';
import type { CompanyOption } from './company-select.js';

/**
 * The search CompanySelect and the search palette take, over the API: the
 * first `limit` companies whose name contains the query, by name. `signal` cancels a search the
 * user has typed past. Pages pass it to the select, which never fetches.
 */
export function useCompanySearch(limit: number) {
  const { swr } = useApi();
  return useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly CompanyOption[]> => {
      const { docs } = await swr.companies.find(
        {
          ...(query === '' ? {} : { where: { name: { contains: query } } }),
          sort: ['name'],
          limit,
        },
        { signal },
      );
      return docs;
    },
    [swr, limit],
  );
}
