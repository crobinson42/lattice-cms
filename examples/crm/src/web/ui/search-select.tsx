import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@shadalaya/react/combobox';
import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import { useEffect, useId, useState } from 'react';

/**
 * What a SearchSelect reads: the items that answer a query, from the
 * server, stopping when the signal aborts.
 */
export type Search<T> = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly T[]>;

/**
 * Picks one item of a long list, found by what the user types: `search`
 * answers a query with the items to offer, from the server, and stops when
 * its signal aborts. It is a form field: `name` submits the picked item's
 * key. It shows `defaultValue`'s label until the user picks another. Arrows
 * move, Enter picks, Esc closes. Live regions say what the list holds.
 */
export function SearchSelect<T>({
  name,
  label,
  placeholder,
  defaultValue,
  search,
  itemKey,
  itemLabel,
  countLabel,
  nothingFound,
  error,
  onPick,
}: {
  /** The form field it submits the key as, or none: then read `onPick`. */
  readonly name?: string;
  readonly label: string;
  readonly placeholder: string;
  readonly defaultValue: T | null;
  readonly search: Search<T>;
  readonly itemKey: (item: T) => string;
  readonly itemLabel: (item: T) => string;
  /** How many items a search found, in words: "3 companies". */
  readonly countLabel: (count: number) => string;
  /** What the list says when a search finds nothing. */
  readonly nothingFound: string;
  readonly error: string | undefined;
  /** Called with the picked item, for a form that needs more than its key. */
  readonly onPick?: (item: T | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(defaultValue);
  const [query, setQuery] = useState('');
  // Each answer keeps its query: only the current query's items are shown,
  // so an older search's items can never be picked.
  const [found, setFound] = useState<{
    readonly query: string;
    readonly items: readonly T[];
  }>();
  const [failed, setFailed] = useState<string>();
  // The input shows the picked item's label: that is not a search.
  const searched =
    picked !== null && query === itemLabel(picked) ? '' : query.trim();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(searched, controller.signal).then(
        (items) => {
          setFound({ query: searched, items });
          setFailed(undefined);
        },
        () => {
          if (!controller.signal.aborted) setFailed(searched);
        },
      );
    }, 250);
    // A search the user has typed past is cancelled.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searched, search]);

  const items = found?.query === searched ? found.items : [];
  // What an empty list says. ComboboxEmpty is Base UI's live region.
  const empty =
    failed === searched
      ? 'The search failed. Type to try again.'
      : found?.query !== searched
        ? 'Searching…'
        : nothingFound;
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox
        id={id}
        {...(name === undefined ? {} : { name })}
        items={items}
        // The server already filtered: show what it found.
        filter={null}
        value={picked}
        onValueChange={(item) => {
          setPicked(item);
          onPick?.(item);
        }}
        onInputValueChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={itemLabel}
        itemToStringValue={itemKey}
        isItemEqualToValue={(item, value) => itemKey(item) === itemKey(value)}
      >
        <ComboboxInput
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
        />
        <ComboboxContent>
          <ComboboxEmpty>{empty}</ComboboxEmpty>
          <ComboboxList>
            {(item: T) => (
              <ComboboxItem key={itemKey(item)} value={item}>
                {itemLabel(item)}
              </ComboboxItem>
            )}
          </ComboboxList>
          {/*
            Says how many were found. Inside the popup: while it is open,
            Base UI hides everything else from assistive tech.
          */}
          <div role="status" className="sr-only">
            {items.length === 0 ? '' : countLabel(items.length)}
          </div>
        </ComboboxContent>
      </Combobox>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
