import { Button } from '@shadalaya/react/button';
import { isRecord } from './catalog.js';
import { type Collection, columnsOf } from './collections.js';
import { useCall } from './data.js';
import { DocumentTable } from './document-table.js';
import { Filters, whereOf } from './filters.js';
import { pluralHeading } from './labels.js';
import { type ListState, listQuery, listStateOf } from './list-state.js';
import { issuesAt, type Refusal, refusalOf } from './refusal.js';
import { useRouter } from './router.js';
import { sortKeysOf } from './schema.js';
import { Loading, NoDocuments, RefusalAlert } from './states.js';

type Page = {
  readonly docs: readonly Record<string, unknown>[];
  readonly next: string | null;
};

/** A `find` output, or nothing when it is not one. */
function pageOf(data: unknown): Page | undefined {
  if (!isRecord(data) || !Array.isArray(data.docs)) return undefined;
  const next = typeof data.next === 'string' ? data.next : null;
  return { docs: data.docs.filter(isRecord), next };
}

function countOf(data: unknown): number | undefined {
  return isRecord(data) && typeof data.count === 'number'
    ? data.count
    : undefined;
}

/** Whether every issue of a refusal shows at a filter or a sort. */
function shownAtControls(refusal: Refusal): boolean {
  return (
    refusal.code === 'VALIDATION' &&
    refusal.issues.length > 0 &&
    refusal.issues.every(({ path: [key] }) => key === 'where' || key === 'sort')
  );
}

/** Back and Next over the cursors seen so far (0008: no page numbers). */
function Pager({
  canBack,
  next,
  onBack,
  onNext,
}: {
  readonly canBack: boolean;
  readonly next: string | null;
  readonly onBack: () => void;
  readonly onNext: (cursor: string) => void;
}) {
  return (
    <nav aria-label="Pages" className="flex justify-end gap-2">
      <Button variant="outline" size="sm" disabled={!canBack} onClick={onBack}>
        Back
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={next === null}
        onClick={() => {
          if (next !== null) onNext(next);
        }}
      >
        Next
      </Button>
    </nav>
  );
}

/** "1 result", "2 results". */
function results(total: number): string {
  return total === 1 ? '1 result' : `${total} results`;
}

/**
 * A collection's list: filters, a one-column sort, cursor pages, and a
 * count of what the filters match. Its state is the URL's query, so back,
 * forward and reload return to it.
 */
export function ListPage({
  collection,
  query,
}: {
  readonly collection: Collection;
  readonly query: URLSearchParams;
}) {
  const { href, navigate } = useRouter();
  const { find, count } = collection.operations;
  const state = listStateOf(query);
  const go = (next: ListState) =>
    navigate(`${href(collection.slug)}${listQuery(next)}`);
  const where = whereOf(collection, state.filters);
  const filtered = Object.keys(where).length > 0 ? { where } : {};
  const after = state.cursors.at(-1);
  const found = useCall(find, {
    ...filtered,
    ...(state.sort === undefined ? {} : { sort: [state.sort] }),
    ...(after === undefined ? {} : { after }),
    populate: find?.expand ?? [],
  });
  const counted = useCall(count, filtered);
  const refusal =
    found.error === undefined ? undefined : refusalOf(found.error);
  const page = pageOf(found.data);
  const total = countOf(counted.data);
  // Shown at the filter or column it names, so the table stays to show it.
  const atControls = refusal !== undefined && shownAtControls(refusal);
  const sortBy = (sort: string) => go({ ...state, sort, cursors: [] });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">
          {pluralHeading(collection.label)}
        </h1>
        {total === undefined ? null : (
          <p className="text-sm text-muted-foreground">{results(total)}</p>
        )}
      </header>
      <Filters
        // Back and forward change the applied filters: start over from them.
        key={JSON.stringify(state.filters)}
        collection={collection}
        applied={state.filters}
        issues={(field) => issuesAt(refusal, 'where', field)}
        onApply={(filters) => go({ ...state, filters, cursors: [] })}
      />
      {refusal !== undefined && !atControls ? (
        <RefusalAlert refusal={refusal} />
      ) : null}
      {counted.error !== undefined && refusal === undefined ? (
        <RefusalAlert refusal={refusalOf(counted.error)} />
      ) : null}
      {found.isLoading && page === undefined ? <Loading /> : null}
      {page !== undefined && page.docs.length === 0 && !atControls ? (
        <NoDocuments plural={collection.label.plural} />
      ) : null}
      {(page !== undefined && page.docs.length > 0) || atControls ? (
        <DocumentTable
          collection={collection}
          columns={columnsOf(collection, page?.docs ?? [])}
          docs={page?.docs ?? []}
          sortKeys={sortKeysOf(find?.input)}
          sort={state.sort}
          sortIssues={issuesAt(refusal, 'sort')}
          onSort={sortBy}
        />
      ) : null}
      <Pager
        canBack={state.cursors.length > 0}
        next={page?.next ?? null}
        onBack={() => go({ ...state, cursors: state.cursors.slice(0, -1) })}
        onNext={(cursor) =>
          go({ ...state, cursors: [...state.cursors, cursor] })
        }
      />
    </section>
  );
}
