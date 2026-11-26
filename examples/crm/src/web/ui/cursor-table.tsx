import type { ReactNode } from 'react';
import { type CursorPages, LoadMore } from './cursor-pages.js';
import { type Column, DataTable, DataTableSkeleton } from './data-table.js';
import { ErrorState } from './states.js';

/**
 * A list read a page at a time, as a table: its skeleton while the first
 * page loads, a retry when it fails, `empty` when there is nothing, then
 * the rows and Load more. `what` names the rows in messages: "deals".
 */
export function CursorTable<T extends { readonly id: string }>({
  label,
  columns,
  pages,
  what,
  empty,
  skeletonRows,
}: {
  readonly label: string;
  readonly columns: readonly Column<T>[];
  readonly pages: CursorPages<T>;
  readonly what: string;
  readonly empty: ReactNode;
  readonly skeletonRows?: number;
}) {
  if (pages.rows === undefined) {
    return pages.error === undefined ? (
      <DataTableSkeleton
        label={label}
        columns={columns}
        {...(skeletonRows === undefined ? {} : { rows: skeletonRows })}
      />
    ) : (
      <ErrorState
        message={`The ${what} could not be loaded.`}
        onRetry={pages.refresh}
      />
    );
  }
  if (pages.rows.length === 0) return empty;
  return (
    <>
      <DataTable
        label={label}
        columns={columns}
        rows={pages.rows}
        rowKey={({ id }) => id}
        focusRow={pages.firstNew}
      />
      <LoadMore pages={pages} what={what} />
    </>
  );
}
