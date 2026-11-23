import { Badge } from '@shadalaya/react/badge';
import { isRecord } from './catalog.js';
import { type Collection, titleFieldOf } from './collections.js';
import { fieldLabel } from './labels.js';
import { useCollection } from './model.js';
import { Link, useRouter } from './router.js';
import type { Field } from './schema.js';

/** What an absent or null value shows. */
const none = '—';

/** A ref as it shows: its id, and its target's title when populated. */
type Shown = {
  readonly id: string;
  readonly title: string | undefined;
  /** Populated as `{ id }`: the caller may not read the target. */
  readonly withheld: boolean;
};

/** A ref's id: the value, or a populated document's `id`. */
export function refIdOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
}

/** A ref's target title, when it was populated with one. */
export function refTitleOf(
  value: unknown,
  target: Collection | undefined,
): string | undefined {
  const field = target === undefined ? undefined : titleFieldOf(target);
  const title =
    field === undefined || !isRecord(value) ? undefined : value[field.name];
  return typeof title === 'string' ? title : undefined;
}

function shownRef(
  value: unknown,
  target: Collection | undefined,
): Shown | undefined {
  const id = refIdOf(value);
  if (id === undefined) return undefined;
  const doc = isRecord(value) ? value : undefined;
  if (doc !== undefined && Object.keys(doc).length === 1) {
    return { id, title: undefined, withheld: true };
  }
  return { id, title: refTitleOf(value, target), withheld: false };
}

function Withheld({ id }: { readonly id: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs">{id}</span>
      <Badge variant="outline">no access</Badge>
    </span>
  );
}

/**
 * A ref: a link to the target document, labelled by its title field when
 * populated. A populated ref the caller may not read arrives as `{ id }`.
 */
export function RefValue({
  target,
  value,
}: {
  readonly target: string | undefined;
  readonly value: unknown;
}) {
  const { href } = useRouter();
  const collection = useCollection(target);
  const shown = shownRef(value, collection);
  if (shown === undefined) return <>{none}</>;
  if (shown.withheld) return <Withheld id={shown.id} />;
  const text = shown.title ?? shown.id;
  if (collection === undefined) return <>{text}</>;
  return (
    <Link
      className="underline underline-offset-4"
      href={href(collection.slug, shown.id)}
    >
      {text}
    </Link>
  );
}

function plainText(field: Field, value: unknown): string {
  if (value === undefined || value === null) return none;
  if (field.kind === 'boolean') return value === true ? 'Yes' : 'No';
  if (field.kind === 'datetime' && typeof value === 'string') {
    return new Date(value).toLocaleString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * One field's value as text, with no link, such as inside a link to its
 * document. A ref shows its target's title, or its id.
 */
export function FieldText({
  field,
  value,
}: {
  readonly field: Field;
  readonly value: unknown;
}) {
  const target = useCollection(field.ref);
  if (field.ref === undefined) return <>{plainText(field, value)}</>;
  const shown = (Array.isArray(value) ? value : [value]).map((item) =>
    shownRef(item, target),
  );
  const [only] = shown;
  if (only?.withheld && shown.length === 1) return <Withheld id={only.id} />;
  const texts = shown.flatMap((ref) =>
    ref === undefined ? [] : [ref.title ?? ref.id],
  );
  return <>{texts.length === 0 ? none : texts.join(', ')}</>;
}

/** One field's value, read-only, by its kind. A ref links to its document. */
export function FieldValue({
  field,
  value,
}: {
  readonly field: Field;
  readonly value: unknown;
}) {
  if (field.ref !== undefined && field.kind === 'ref') {
    return <RefValue target={field.ref} value={value} />;
  }
  if (field.ref !== undefined && Array.isArray(value)) {
    return (
      <span className="inline-flex flex-wrap gap-2">
        {value.map((item, index) => (
          <RefValue
            // biome-ignore lint/suspicious/noArrayIndexKey: ids may repeat in a list, and it never reorders
            key={index}
            target={field.ref}
            value={item}
          />
        ))}
      </span>
    );
  }
  return <FieldText field={field} value={value} />;
}

/** Fields as label and value rows. */
export function FieldList({
  fields,
  doc,
}: {
  readonly fields: readonly Field[];
  readonly doc: Record<string, unknown>;
}) {
  return (
    <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2">
      {fields.map((field) => (
        <div key={field.name} className="contents">
          <dt className="text-muted-foreground">{fieldLabel(field)}</dt>
          <dd>
            <FieldValue field={field} value={doc[field.name]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
