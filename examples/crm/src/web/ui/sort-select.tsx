import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import type { SortOption } from './list-params.js';

/** Picks one of a list's sorts. */
export function SortSelect<S extends string>({
  sorts,
  value,
  onChange,
}: {
  readonly sorts: readonly SortOption<S>[];
  readonly value: S;
  readonly onChange: (sort: S) => void;
}) {
  return (
    <NativeSelect
      aria-label="Sort by"
      value={value}
      onChange={(event) => {
        const sort = sorts.find(({ value }) => value === event.target.value);
        if (sort !== undefined) onChange(sort.value);
      }}
    >
      {sorts.map(({ value, label }) => (
        <NativeSelectOption key={value} value={value}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
