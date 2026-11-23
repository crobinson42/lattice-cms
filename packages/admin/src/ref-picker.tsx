import { Button } from '@shadalaya/react/button';
import { Input } from '@shadalaya/react/input';
import { useState } from 'react';
import { isRecord } from './catalog.js';
import { type Collection, titleFieldOf } from './collections.js';
import { useCall } from './data.js';
import { useCollection } from './model.js';
import type { Field } from './schema.js';

/** How many matches a search shows. */
const shownMatches = 10;

/**
 * A document's title: `known` when the caller already has it, else read
 * with the target's get, else its id.
 */
function RefTitle({
  collection,
  title,
  id,
  known,
}: {
  readonly collection: Collection;
  readonly title: Field;
  readonly id: string;
  readonly known: string | undefined;
}) {
  const { data } = useCall(
    known === undefined ? collection.operations.get : undefined,
    { id },
  );
  const read = isRecord(data) ? data[title.name] : undefined;
  return <>{known ?? (typeof read === 'string' ? read : id)}</>;
}

/** A match: its id, and its title to show. */
type Match = { readonly id: string; readonly name: string };

/**
 * A search box over the target's title field, with `contains`, and its
 * matches as buttons that pick one. Enter picks the first match instead of
 * submitting the form around it.
 */
function Search({
  id,
  collection,
  title,
  onPick,
}: {
  readonly id: string;
  readonly collection: Collection;
  readonly title: Field;
  readonly onPick: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const query = text.trim();
  const { data } = useCall(
    query === '' ? undefined : collection.operations.find,
    { where: { [title.name]: { contains: query } }, limit: shownMatches },
  );
  // An empty search shows no matches, not the last search's.
  const docs =
    query !== '' && isRecord(data) && Array.isArray(data.docs) ? data.docs : [];
  const matches: Match[] = docs.filter(isRecord).flatMap((doc) => {
    const name = doc[title.name];
    return typeof doc.id === 'string'
      ? [{ id: doc.id, name: typeof name === 'string' ? name : doc.id }]
      : [];
  });
  const pick = (picked: string) => {
    onPick(picked);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        type="search"
        placeholder={`Search ${collection.label.plural}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const [first] = matches;
          if (first !== undefined) pick(first.id);
        }}
      />
      <ul
        aria-label={`Matching ${collection.label.plural}`}
        className="flex flex-col"
      >
        {matches.map((match) => (
          <li key={match.id}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => pick(match.id)}
            >
              {match.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Picks one document of `target` by searching its title field. A target
 * with no title field takes a plain id. `title` is the picked document's,
 * when the caller already has it, so no get is needed to show it.
 */
export function RefPicker({
  id,
  target,
  value,
  title: known,
  onChange,
}: {
  readonly id: string;
  readonly target: string | undefined;
  readonly value: string;
  readonly title?: string | undefined;
  readonly onChange: (id: string) => void;
}) {
  const collection = useCollection(target);
  const title = collection === undefined ? undefined : titleFieldOf(collection);
  if (collection === undefined || title === undefined) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {value === '' ? null : (
        <p className="flex items-center gap-2">
          <span>
            <RefTitle
              collection={collection}
              title={title}
              id={value}
              known={known}
            />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange('')}
          >
            Clear
          </Button>
        </p>
      )}
      <Search id={id} collection={collection} title={title} onPick={onChange} />
    </div>
  );
}

/**
 * Picks a list of documents of `target`, one search at a time. With no
 * title field to search, the ids are typed, comma-separated, and the text
 * is kept as typed.
 */
export function RefsPicker({
  id,
  target,
  value,
  onChange,
}: {
  readonly id: string;
  readonly target: string | undefined;
  readonly value: string | readonly string[];
  readonly onChange: (ids: string | readonly string[]) => void;
}) {
  const collection = useCollection(target);
  const title = collection === undefined ? undefined : titleFieldOf(collection);
  if (collection === undefined || title === undefined) {
    return (
      <Input
        id={id}
        placeholder="Comma-separated ids"
        value={typeof value === 'string' ? value : value.join(', ')}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const picked = typeof value === 'string' ? value.split(',') : value;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {picked.map((item) => (
          <li key={item} className="flex items-center gap-1">
            <RefTitle
              collection={collection}
              title={title}
              id={item}
              known={undefined}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onChange(picked.filter((other) => other !== item))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Search
        id={id}
        collection={collection}
        title={title}
        onPick={(added) =>
          onChange(picked.includes(added) ? picked : [...picked, added])
        }
      />
    </div>
  );
}
