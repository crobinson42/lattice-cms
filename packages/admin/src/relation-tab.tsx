import { Button } from '@shadalaya/react/button';
import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shadalaya/react/table';
import type { JsonSchema } from '@ts-pf/docs';
import { useEffect, useId, useState } from 'react';
import { type Collection, documentOf, type Relation } from './collections.js';
import { ConfirmDialog } from './confirm.js';
import { useCall, useCaller, useRevalidate } from './data.js';
import {
  bodyOf,
  type Drafts,
  draftsOf,
  FormFields,
  type InputField,
  inputFieldsOf,
} from './form.js';
import { fieldLabel, relationLabel, singularHeading } from './labels.js';
import { Pager, pageOf } from './list-page.js';
import { listQuery, listStateOf } from './list-state.js';
import { useCollection } from './model.js';
import { RefPicker } from './ref-picker.js';
import { type Issue, issuesUnder, type Refusal, refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { useRouter } from './router.js';
import {
  type Field as DocumentField,
  fieldsOf,
  propertiesOf,
  resolve,
} from './schema.js';
import { Loading } from './states.js';
import { FieldValue, refIdOf, refTitleOf } from './value.js';

/** The most links one `set` takes, as core's `maxLinks` says. */
const maxLinks = 1000;

/** A page of links while loading them all: `list`'s largest page. */
const loadPage = 100;

/** "1 link", "2 links". */
function links(total: number): string {
  return total === 1 ? '1 link' : `${total} links`;
}

/** A link's columns: its target, then its fields. Not the parent's ref. */
function linkColumns(
  collection: Collection,
  relation: Relation,
): readonly DocumentField[] {
  const fields = fieldsOf(documentOf(relation.list)).filter(
    (field) =>
      !field.system &&
      !(field.ref === collection.slug && field.ref !== relation.target),
  );
  return [
    ...fields.filter((field) => field.ref === relation.target),
    ...fields.filter((field) => field.ref !== relation.target),
  ];
}

/** The schema of one link in `set`'s input, and its target's field. */
function linkSchemaOf(relation: Relation): {
  readonly target: string | undefined;
  readonly fields: readonly InputField[];
} {
  const input = relation.set?.input;
  const entry =
    input === undefined
      ? undefined
      : propertiesOf(input).find(([name]) => name === 'links');
  const item: JsonSchema =
    input === undefined || entry === undefined
      ? {}
      : resolve(entry[1].items, input);
  const target = propertiesOf(item).find(
    ([, schema]) => schema['x-lattice-ref'] === relation.target,
  )?.[0];
  return {
    target,
    fields: inputFieldsOf(item, target === undefined ? [] : [target]),
  };
}

/**
 * One link being edited: its target's id, the target's title when the list
 * populated it, and its fields' drafts.
 */
type Row = {
  readonly key: number;
  readonly target: string;
  readonly title: string | undefined;
  readonly drafts: Drafts;
};

type Loaded =
  | { readonly state: 'loading' }
  | {
      readonly state: 'loaded';
      readonly links: readonly Record<string, unknown>[];
    }
  | { readonly state: 'too many' }
  | { readonly state: 'refused'; readonly refusal: Refusal };

/** Every link of the document, page by page, up to what `set` takes. */
function useAllLinks(relation: Relation, id: string): Loaded {
  const call = useCaller();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const list = relation.list;
  useEffect(() => {
    if (list === undefined) return;
    let current = true;
    const load = async () => {
      const all: Record<string, unknown>[] = [];
      let after: string | undefined;
      do {
        const page = pageOf(
          // Populated, so each row shows its target's title without a get.
          await call(list, {
            id,
            limit: loadPage,
            populate: list.expand,
            ...(after === undefined ? {} : { after }),
          }),
        );
        all.push(...(page?.docs ?? []));
        after = page?.next ?? undefined;
      } while (after !== undefined && all.length <= maxLinks);
      return all.length > maxLinks ? undefined : all;
    };
    load().then(
      (all) => {
        if (current) {
          setLoaded(
            all === undefined
              ? { state: 'too many' }
              : { state: 'loaded', links: all },
          );
        }
      },
      (error: unknown) => {
        if (current) setLoaded({ state: 'refused', refusal: refusalOf(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [call, list, id]);
  return loaded;
}

/**
 * The editor of a relation's `set`: every link, each with its target and
 * fields, then the whole set sent at once after asking. A refusal keeps
 * the edits.
 */
function SetEditor({
  collection,
  relation,
  id,
  onDone,
}: {
  readonly collection: Collection;
  readonly relation: Relation;
  readonly id: string;
  readonly onDone: () => void;
}) {
  const call = useCaller();
  const revalidate = useRevalidate();
  const target = useCollection(relation.target);
  const schema = linkSchemaOf(relation);
  const loaded = useAllLinks(relation, id);
  const [rows, setRows] = useState<readonly Row[] | undefined>();
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const [problems, setProblems] = useState<readonly Issue[]>([]);
  const pickerId = useId();
  const set = relation.set;
  const targetField = schema.target;

  if (loaded.state === 'loading') return <Loading />;
  if (loaded.state === 'refused')
    return <RefusalAlert refusal={loaded.refusal} />;
  if (loaded.state === 'too many') {
    return (
      <p role="alert">
        This document has more than {maxLinks}{' '}
        {relationLabel(relation.name).toLowerCase()}, more than one set takes.
        Change them with a method instead.
      </p>
    );
  }
  if (set === undefined || targetField === undefined) return null;
  const current =
    rows ??
    loaded.links.map((link, key) => ({
      key,
      target: refIdOf(link[targetField]) ?? '',
      title: refTitleOf(link[targetField], target),
      drafts: draftsOf(schema.fields, link),
    }));
  // Every link is sent whole: `set` replaces them all.
  const made = current.map((row, index) => {
    const { body, problems: found } = bodyOf(schema.fields, row.drafts, {});
    return {
      link: { [targetField]: row.target, ...body },
      problems: found.map((issue) => ({
        ...issue,
        path: ['links', index, ...issue.path],
      })),
    };
  });
  // An issue shows in a row when it names a row and a field the row shows.
  const placed = ({ path: [key, index, field] }: Issue) =>
    key === 'links' &&
    typeof index === 'number' &&
    index < current.length &&
    (field === targetField || schema.fields.some(({ name }) => name === field));
  const issues = [...problems, ...(refusal?.issues ?? [])];
  const update = (key: number, patch: Partial<Row>) =>
    setRows(
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  const save = async () => {
    setRefusal(undefined);
    try {
      await call(set, { id, links: made.map(({ link }) => link) });
    } catch (error) {
      setRefusal(refusalOf(error));
      return;
    }
    await revalidate(collection, ...(target === undefined ? [] : [target]));
    onDone();
  };

  return (
    <form
      aria-label={`Edit ${relationLabel(relation.name).toLowerCase()}`}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = made.flatMap((row) => row.problems);
        setProblems(found);
        if (found.length === 0) setAsking(true);
      }}
    >
      {current.map((row, index) => (
        <fieldset
          key={row.key}
          className="flex flex-col gap-2 rounded-lg border p-3"
        >
          <legend className="sr-only">Link {index + 1}</legend>
          <Field>
            <FieldLabel htmlFor={`${pickerId}-${row.key}`}>
              {target === undefined
                ? relationLabel(relation.name)
                : singularHeading(target.label)}
            </FieldLabel>
            <RefPicker
              id={`${pickerId}-${row.key}`}
              target={relation.target}
              value={row.target}
              title={row.title}
              onChange={(picked) =>
                update(row.key, { target: picked, title: undefined })
              }
            />
            <FieldError
              errors={issuesUnder(issues, ['links', index, targetField])}
            />
          </Field>
          <FormFields
            fields={schema.fields}
            drafts={row.drafts}
            issues={issues}
            at={['links', index]}
            onChange={(drafts) => update(row.key, { drafts })}
          />
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setRows(current.filter(({ key }) => key !== row.key))
              }
            >
              Remove link
            </Button>
          </div>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows([
              ...current,
              {
                key: Math.max(-1, ...current.map(({ key }) => key)) + 1,
                target: '',
                title: undefined,
                drafts: draftsOf(schema.fields, {}),
              },
            ])
          }
        >
          Add link
        </Button>
        <Button type="submit">Save links</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {refusal === undefined ? null : (
        <RefusalAlert refusal={refusal} placed={placed} />
      )}
      <ConfirmDialog
        confirmation={{
          title: `Replace the ${relationLabel(relation.name).toLowerCase()}?`,
          description: `Links not listed here are removed. ${links(current.length)} will remain.`,
          action: 'Save links',
          destructive: true,
        }}
        open={asking}
        onOpenChange={setAsking}
        onConfirm={() => void save()}
      />
    </form>
  );
}

/**
 * A relation's tab on its document's page: its links, page by page, each
 * going to its target, and an editor for `set`.
 */
export function RelationTab({
  collection,
  relation,
  id,
  query,
  total,
}: {
  readonly collection: Collection;
  readonly relation: Relation;
  readonly id: string;
  readonly query: URLSearchParams;
  /** How many links the document has, from its populated `get`. */
  readonly total: number | undefined;
}) {
  const { href, navigate } = useRouter();
  const [editing, setEditing] = useState(false);
  const { cursors } = listStateOf(query);
  const after = cursors.at(-1);
  const list = relation.list;
  const { data, error, isLoading } = useCall(list, {
    id,
    populate: list?.expand ?? [],
    ...(after === undefined ? {} : { after }),
  });
  const page = pageOf(data);
  const columns = linkColumns(collection, relation);
  const go = (next: readonly string[]) =>
    navigate(
      `${href(collection.slug, id, 'relations', relation.name)}${listQuery({ filters: [], sort: undefined, cursors: next })}`,
    );

  if (editing) {
    return (
      <SetEditor
        collection={collection}
        relation={relation}
        id={id}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <section
      aria-label={relationLabel(relation.name)}
      className="flex flex-col gap-4"
    >
      <header className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total === undefined ? null : links(total)}
        </p>
        {relation.set === undefined ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            Edit links
          </Button>
        )}
      </header>
      {error === undefined ? null : <RefusalAlert refusal={refusalOf(error)} />}
      {isLoading && page === undefined ? <Loading /> : null}
      {page === undefined ? null : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((field) => (
                <TableHead key={field.name}>{fieldLabel(field)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.docs.map((link) => (
              <TableRow
                key={
                  typeof link.id === 'string' ? link.id : JSON.stringify(link)
                }
              >
                {columns.map((field) => (
                  <TableCell key={field.name}>
                    <FieldValue field={field} value={link[field.name]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager
        canBack={cursors.length > 0}
        next={page?.next ?? null}
        onBack={() => go(cursors.slice(0, -1))}
        onNext={(cursor) => go([...cursors, cursor])}
      />
    </section>
  );
}
