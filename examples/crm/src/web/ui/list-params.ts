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

/**
 * The search for `params`, without the defaults: "?q=acme". Other keys of
 * `search`, such as a list's filter, are kept.
 */
export function writeListParams<S extends string>(
  { q, sort }: ListParams<S>,
  fallback: S,
  search = '',
): string {
  const params = new URLSearchParams(search);
  if (q === '') params.delete('q');
  else params.set('q', q);
  if (sort === fallback) params.delete('sort');
  else params.set('sort', sort);
  return searchOf(params);
}

function searchOf(params: URLSearchParams): string {
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
  const search = useSearch();
  const params = readListParams(search, sorts, fallback);
  const show = useCallback(
    (next: ListParams<S>) =>
      navigate(`${path}${writeListParams(next, fallback, search)}`, {
        replace: true,
      }),
    [navigate, path, fallback, search],
  );
  return [params, show] as const;
}

/**
 * One option of a list kept in the URL, such as a filter: `name`'s value
 * when it is one of `values`, or undefined. Setting undefined removes it.
 * The list's other keys are kept.
 */
export function useUrlOption<V extends string>(
  name: string,
  values: readonly V[],
) {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const current = new URLSearchParams(search).get(name);
  const value = values.find((option) => option === current);
  const set = useCallback(
    (next: V | undefined) => {
      const params = new URLSearchParams(search);
      if (next === undefined) params.delete(name);
      else params.set(name, next);
      navigate(`${path}${searchOf(params)}`, { replace: true });
    },
    [navigate, path, search, name],
  );
  return [value, set] as const;
}
