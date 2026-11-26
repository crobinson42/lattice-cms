import { useCallback } from 'react';
import { useApi } from '../../api.js';
import type { ContactOption } from './contact-select.js';

/**
 * The search ContactSelect takes, over the API. With nothing typed, it
 * offers the contacts at `companyId`, such as a deal's company, the likely
 * ones; typing searches every contact by name. `exclude` leaves contacts
 * out, such as those already on the deal. `signal` cancels a search the
 * user has typed past.
 */
export function useContactSearch(
  companyId: string | undefined,
  exclude: readonly string[],
) {
  const { swr } = useApi();
  // A stable dependency: the list's ids, not a new array per render.
  const excluded = exclude.join(' ');
  return useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly ContactOption[]> => {
      const ids = excluded === '' ? [] : excluded.split(' ');
      const where = {
        ...(query !== ''
          ? { name: { contains: query } }
          : companyId === undefined
            ? {}
            : { companyId: { eq: companyId } }),
        ...(ids.length === 0 ? {} : { id: { nin: ids } }),
      };
      const { docs } = await swr.contacts.find(
        { where, sort: ['name'], limit: 20 },
        { signal },
      );
      return docs;
    },
    [swr, companyId, excluded],
  );
}
