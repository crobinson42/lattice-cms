import { isRecord } from './catalog.js';
import { fieldLabel, pluralHeading } from './labels.js';
import { listQuery } from './list-state.js';
import { useCollection } from './model.js';
import type { Issue, Refusal } from './refusal.js';
import { Link, useRouter } from './router.js';
import { ErrorAlert } from './states.js';

/** REFERENCED's data: the document, and a collection and field that refer to it. */
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
  return { collection, id, child: by.collection, field: by.field };
}

/**
 * What blocks a delete, such as "Deals still refer to this company
 * (Company)": a link to the child list, filtered to the documents that do.
 */
function Referenced({
  collection,
  id,
  child,
  field,
}: {
  readonly collection: string;
  readonly id: string;
  readonly child: string;
  readonly field: string;
}) {
  const { href } = useRouter();
  const parent = useCollection(collection);
  const children = useCollection(child);
  const childField = children?.fields.find(({ name }) => name === field);
  const fieldText = fieldLabel(childField ?? { name: field, title: undefined });
  const what = parent === undefined ? 'document' : parent.label.singular;
  const text = `${children === undefined ? child : pluralHeading(children.label)} still refer to this ${what} (${fieldText}).`;
  // A join collection has no list of its own: the text stands alone.
  if (children === undefined) return <p>{text}</p>;
  const query = listQuery({
    filters: [[field, 'eq', id]],
    sort: undefined,
    cursors: [],
  });
  return (
    <p>
      <Link
        className="underline underline-offset-4"
        href={`${href(children.slug)}${query}`}
      >
        {text}
      </Link>
    </p>
  );
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
