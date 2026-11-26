import { useCallback } from 'react';
import { useApi } from '../../api.js';
import type { CompanyOption } from './company-select.js';

/**
 * The search CompanySelect takes, over the API: the first 20 companies
 * whose name contains the query, by name. `signal` cancels a search the
 * user has typed past. Pages pass it to the select, which never fetches.
 */
export function useCompanySearch() {
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
          limit: 20,
        },
        { signal },
      );
      return docs;
    },
    [swr],
  );
}
