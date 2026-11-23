import { FieldError } from '@shadalaya/react/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shadalaya/react/table';
import type { Collection } from './collections.js';
import { fieldLabel } from './labels.js';
import type { Issue } from './refusal.js';
import { Link, useRouter } from './router.js';
import type { Field } from './schema.js';
import { FieldText, FieldValue } from './value.js';

/** The next sort a header click makes: ascending, then descending. */
function nextSort(name: string, sort: string | undefined): string {
  return sort === name ? `-${name}` : name;
}

function ariaSort(name: string, sort: string | undefined) {
  if (sort === name) return 'ascending';
  if (sort === `-${name}`) return 'descending';
  return undefined;
}

/** A column header: a sort button when `find` can sort by the field. */
function ColumnHeader({
  field,
  sortable,
  sort,
  issues,
  onSort,
}: {
  readonly field: Field;
  readonly sortable: boolean;
  readonly sort: string | undefined;
  readonly issues: readonly Issue[];
  readonly onSort: (sort: string) => void;
}) {
  const label = fieldLabel(field);
  const direction = ariaSort(field.name, sort);
  if (!sortable) return <TableHead>{label}</TableHead>;
  return (
    <TableHead aria-sort={direction ?? 'none'}>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-medium"
        onClick={() => onSort(nextSort(field.name, sort))}
      >
        {label}
        <span aria-hidden="true">
          {direction === 'ascending'
            ? '↑'
            : direction === 'descending'
              ? '↓'
              : ''}
        </span>
      </button>
      {direction === undefined ? null : <FieldError errors={[...issues]} />}
    </TableHead>
  );
}

/**
 * One page of documents, in the list's columns. The first column links to
 * each document. A sort refused as `VALIDATION` shows at its column.
 */
export function DocumentTable({
  collection,
  columns,
  docs,
  sortKeys,
  sort,
  sortIssues,
  onSort,
}: {
  readonly collection: Collection;
  readonly columns: readonly Field[];
  readonly docs: readonly Record<string, unknown>[];
  readonly sortKeys: ReadonlySet<string>;
  readonly sort: string | undefined;
  readonly sortIssues: readonly Issue[];
  readonly onSort: (sort: string) => void;
}) {
  const { href } = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((field) => (
            <ColumnHeader
              key={field.name}
              field={field}
              sortable={sortKeys.has(field.name)}
              sort={sort}
              issues={sortIssues}
              onSort={onSort}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.map((doc) => {
          const id = typeof doc.id === 'string' ? doc.id : '';
          return (
            <TableRow key={id}>
              {columns.map((field, index) => (
                <TableCell key={field.name}>
                  {index === 0 ? (
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={href(collection.slug, id)}
                    >
                      <FieldText field={field} value={doc[field.name]} />
                    </Link>
                  ) : (
                    <FieldValue field={field} value={doc[field.name]} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
