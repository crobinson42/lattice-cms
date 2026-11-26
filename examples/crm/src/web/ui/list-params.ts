import { useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';

// A list's state in the URL: its search and its sort. Back, forward and
// reload return to the same list, and a link can share it.

/** A sort a list offers: the key the API takes, and its name. */
export type SortOption<S extends string> = {
  readonly value: S;
  readonly label: string;
};

export type ListParams<S extends string> = {
  readonly q: string;
  readonly sort: S;
};

/** The list's state from a URL's search: an unknown sort is `fallback`. */
export function readListParams<S extends string>(
  search: string,
  sorts: readonly SortOption<S>[],
  fallback: S,
): ListParams<S> {
  const params = new URLSearchParams(search);
  const sort = params.get('sort');
  return {
    q: params.get('q')?.trim() ?? '',
    sort: sorts.find(({ value }) => value === sort)?.value ?? fallback,
  };
}

/** The search for `params`, without the defaults: "?q=acme". */
export function writeListParams<S extends string>(
  { q, sort }: ListParams<S>,
  fallback: S,
): string {
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (sort !== fallback) params.set('sort', sort);
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/**
 * The list's state, and a way to change it. A change replaces the URL, so
 * back leaves the list rather than stepping through each search.
 */
export function useListParams<S extends string>(
  sorts: readonly SortOption<S>[],
  fallback: S,
) {
  const [path, navigate] = useLocation();
  const params = readListParams(useSearch(), sorts, fallback);
  const show = useCallback(
    (next: ListParams<S>) =>
      navigate(`${path}${writeListParams(next, fallback)}`, { replace: true }),
    [navigate, path, fallback],
  );
  return [params, show] as const;
}
