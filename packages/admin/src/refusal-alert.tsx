import { isRecord } from './catalog.js';
import { fieldLabel, pluralHeading, relationLabel } from './labels.js';
import { listQuery } from './list-state.js';
import { useCollection } from './model.js';
import type { Issue, Refusal } from './refusal.js';
import { Link, useRouter } from './router.js';
import { ErrorAlert } from './states.js';

/** A relation REFERENCED names: its parent collection and its name. */
type RelationName = { readonly collection: string; readonly name: string };

function relationOf(value: unknown): RelationName | undefined {
  if (!isRecord(value)) return undefined;
  const { collection, name } = value;
  return typeof collection === 'string' && typeof name === 'string'
    ? { collection, name }
    : undefined;
}

/**
 * REFERENCED's data: the document, a collection and field that refer to
 * it, and for a join collection the relation that derived it.
 */
function referencedOf(data: unknown) {
  if (!isRecord(data) || !isRecord(data.by)) return undefined;
  const { collection, id, by } = data;
  if (
    typeof collection !== 'string' ||
    typeof id !== 'string' ||
    typeof by.collection !== 'string' ||
    typeof by.field !== 'string'
  ) {
    return undefined;
  }
  return {
    collection,
    id,
    child: by.collection,
    field: by.field,
    relation: relationOf(by.relation),
  };
}

/** A link in the alert's text. */
function TextLink({
  href,
  text,
}: {
  readonly href: string;
  readonly text: string;
}) {
  return (
    <p>
      <Link className="underline underline-offset-4" href={href}>
        {text}
      </Link>
    </p>
  );
}

/**
 * What blocks a delete, such as "Deals still refer to this company
 * (Company)": a link to the child list, filtered to the documents that do.
 * A join collection is not in the catalog, so its relation speaks for it:
 * "Deals still list this contact (Contacts)", linking to the parents' list,
 * which cannot be filtered to the ones that do.
 */
function Referenced({
  collection,
  id,
  child,
  field,
  relation,
}: {
  readonly collection: string;
  readonly id: string;
  readonly child: string;
  readonly field: string;
  readonly relation: RelationName | undefined;
}) {
  const { href } = useRouter();
  const target = useCollection(collection);
  const children = useCollection(child);
  const parents = useCollection(relation?.collection);
  const what = target === undefined ? 'document' : target.label.singular;
  if (relation !== undefined && parents !== undefined) {
    return (
      <TextLink
        href={href(parents.slug)}
        text={`${pluralHeading(parents.label)} still list this ${what} (${relationLabel(relation.name)}).`}
      />
    );
  }
  const childField = children?.fields.find(({ name }) => name === field);
  const fieldText = fieldLabel(childField ?? { name: field, title: undefined });
  const text = `${children === undefined ? child : pluralHeading(children.label)} still refer to this ${what} (${fieldText}).`;
  // A collection outside the catalog has no list of its own: the text
  // stands alone.
  if (children === undefined) return <p>{text}</p>;
  const query = listQuery({
    filters: [[field, 'eq', id]],
    sort: undefined,
    cursors: [],
  });
  return <TextLink href={`${href(children.slug)}${query}`} text={text} />;
}

/**
 * A refused or failed call: the server's code and message, every issue not
 * shown at a field, and for REFERENCED what still refers to the document.
 * A VALIDATION whose issues are all shown at fields shows nothing here.
 */
export function RefusalAlert({
  refusal,
  placed = () => false,
}: {
  readonly refusal: Refusal;
  /** Whether a field shows this issue, so the alert need not. */
  readonly placed?: (issue: Issue) => boolean;
}) {
  const unplaced = refusal.issues.filter((issue) => !placed(issue));
  if (
    refusal.code === 'VALIDATION' &&
    refusal.issues.length > 0 &&
    unplaced.length === 0
  ) {
    return null;
  }
  const referenced =
    refusal.code === 'REFERENCED' ? referencedOf(refusal.data) : undefined;
  return (
    <ErrorAlert title={refusal.code} message={refusal.message}>
      {referenced === undefined ? null : <Referenced {...referenced} />}
      {unplaced.length === 0 ? null : (
        <ul>
          {unplaced.map((issue) => (
            <li key={`${issue.path.join('.')}:${issue.message}`}>
              {issue.path.length === 0 ? '' : `${issue.path.join('.')}: `}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </ErrorAlert>
  );
}
