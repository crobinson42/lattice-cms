/** One applied filter: a field, its operator, and the value as typed. */
export type Filter = readonly [field: string, operator: string, value: string];

/**
 * What a list shows, kept in its URL's query so back, forward and reload
 * return to it: `filters` (JSON), `sort`, and one `after` per page turned.
 */
export type ListState = {
  readonly filters: readonly Filter[];
  readonly sort: string | undefined;
  /** The cursor of each page after the first, so Back can return. */
  readonly cursors: readonly string[];
};

function isFilter(value: unknown): value is Filter {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === 'string')
  );
}

function filtersOf(text: string | null): Filter[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isFilter) : [];
  } catch {
    // A hand-edited query that is not JSON filters nothing.
    return [];
  }
}

/** The list state a query holds. Anything unreadable is left out. */
export function listStateOf(query: URLSearchParams): ListState {
  return {
    filters: filtersOf(query.get('filters')),
    sort: query.get('sort') ?? undefined,
    cursors: query.getAll('after'),
  };
}

/** The query that holds `state`, with its `?`, or nothing for the default. */
export function listQuery(state: ListState): string {
  const query = new URLSearchParams();
  if (state.filters.length > 0) {
    query.set('filters', JSON.stringify(state.filters));
  }
  if (state.sort !== undefined) query.set('sort', state.sort);
  for (const cursor of state.cursors) query.append('after', cursor);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}
