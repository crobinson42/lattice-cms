import { Skeleton } from '@shadalaya/react/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shadalaya/react/table';
import { type ReactNode, useEffect, useRef } from 'react';

/** A column of a table of `T`. */
export type Column<T> = {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
};

function Head<T>({ columns }: { readonly columns: readonly Column<T>[] }) {
  return (
    <TableHeader>
      <TableRow>
        {columns.map(({ key, header }) => (
          <TableHead key={key}>{header}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

/**
 * Rows of `T`, one cell per column. `label` names the table for assistive
 * tech. When `focusRow` names a row, focus moves to it once it is there:
 * the first link or button in it, or the row.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  focusRow,
}: {
  readonly label: string;
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly focusRow?: number | undefined;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const focused = useRef<number>(undefined);
  useEffect(() => {
    if (focusRow === undefined || focused.current === focusRow) return;
    // The row may not have arrived yet: this runs again when it does.
    if (rows.length <= focusRow) return;
    const row = body.current?.rows.item(focusRow);
    if (row === null || row === undefined) return;
    focused.current = focusRow;
    (row.querySelector<HTMLElement>('a[href], button') ?? row).focus();
  }, [focusRow, rows.length]);
  return (
    <Table aria-label={label}>
      <Head columns={columns} />
      <TableBody ref={body}>
        {rows.map((row) => (
          <TableRow key={rowKey(row)} tabIndex={-1}>
            {columns.map(({ key, cell }) => (
              <TableCell key={key}>{cell(row)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** DataTable's place while its rows load. */
export function DataTableSkeleton<T>({
  label,
  columns,
  rows = 5,
}: {
  readonly label: string;
  readonly columns: readonly Column<T>[];
  readonly rows?: number;
}) {
  return (
    <Table aria-label={label} aria-busy>
      <Head columns={columns} />
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no id.
          <TableRow key={row}>
            {columns.map(({ key }) => (
              <TableCell key={key}>
                <Skeleton className="h-4 w-24" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
