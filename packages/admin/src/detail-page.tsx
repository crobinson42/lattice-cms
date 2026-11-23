import { buttonVariants } from '@shadalaya/react/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@shadalaya/react/card';
import { isRecord } from './catalog.js';
import { type Collection, titleFieldOf } from './collections.js';
import { useCall } from './data.js';
import { DeleteAction } from './delete-action.js';
import { pluralHeading, relationLabel, singularHeading } from './labels.js';
import { isDocumentMethod, MethodAction } from './method-action.js';
import { refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { RelationTab } from './relation-tab.js';
import { Link, useRouter } from './router.js';
import { Loading, NotFound } from './states.js';
import { FieldList } from './value.js';

/** The document's fields, then its system fields apart. */
function DocumentFields({
  collection,
  doc,
}: {
  readonly collection: Collection;
  readonly doc: Record<string, unknown>;
}) {
  // A maskable field the caller did not receive is withheld from it.
  const shown = collection.fields.filter(
    (field) => !(field.maskable && doc[field.name] === undefined),
  );
  return (
    <div className="flex flex-col gap-6">
      <FieldList fields={shown.filter((field) => !field.system)} doc={doc} />
      <section aria-label="System fields">
        <FieldList fields={shown.filter((field) => field.system)} doc={doc} />
      </section>
    </div>
  );
}

/** The document's tabs: its fields, then one per relation. Real links. */
function Tabs({
  collection,
  id,
  tab,
}: {
  readonly collection: Collection;
  readonly id: string;
  readonly tab: string | undefined;
}) {
  const { href } = useRouter();
  if (collection.relations.length === 0) return null;
  const tabs = [
    { name: undefined, label: 'Details', to: href(collection.slug, id) },
    ...collection.relations.map((relation) => ({
      name: relation.name,
      label: relationLabel(relation.name),
      to: href(collection.slug, id, 'relations', relation.name),
    })),
  ];
  return (
    <nav aria-label="Tabs" className="flex gap-4 border-b">
      {tabs.map(({ name, label, to }) => (
        <Link
          key={to}
          href={to}
          aria-current={name === tab ? 'page' : undefined}
          className="-mb-px border-b-2 border-transparent px-1 pb-2 aria-[current=page]:border-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** What the document can do: edit, delete, and its methods. */
function Actions({
  collection,
  id,
}: {
  readonly collection: Collection;
  readonly id: string;
}) {
  const { href } = useRouter();
  return (
    <div className="flex flex-wrap items-start gap-2">
      {collection.operations.update === undefined ? null : (
        <Link
          className={buttonVariants({ variant: 'outline' })}
          href={href(collection.slug, id, 'edit')}
        >
          Edit
        </Link>
      )}
      {collection.methods.filter(isDocumentMethod).map((method) => (
        <MethodAction
          key={method.name}
          collection={collection}
          method={method}
          id={id}
        />
      ))}
      <DeleteAction collection={collection} id={id} />
    </div>
  );
}

/**
 * A document's page: `get` with every field `populate` takes, its actions,
 * and a tab per relation.
 */
export function DetailPage({
  collection,
  id,
  tab,
  query,
}: {
  readonly collection: Collection;
  readonly id: string;
  readonly tab: string | undefined;
  readonly query: URLSearchParams;
}) {
  const { href } = useRouter();
  const { get } = collection.operations;
  const { data, error, isLoading } = useCall(get, {
    id,
    populate: get?.expand ?? [],
  });
  const refusal = error === undefined ? undefined : refusalOf(error);
  const relation = collection.relations.find(({ name }) => name === tab);
  const title = titleFieldOf(collection);
  const doc = isRecord(data) ? data : undefined;
  const heading = title === undefined ? undefined : doc?.[title.name];
  const links = relation === undefined ? undefined : doc?.[relation.name];
  return (
    <section className="flex flex-col gap-4">
      <Link
        className="text-sm text-muted-foreground hover:underline"
        href={href(collection.slug)}
      >
        ← {pluralHeading(collection.label)}
      </Link>
      {isLoading && doc === undefined ? <Loading /> : null}
      {refusal?.code === 'NOT_FOUND' ? (
        <NotFound what={`No ${collection.label.singular} with id ${id}.`} />
      ) : null}
      {refusal !== undefined && refusal.code !== 'NOT_FOUND' ? (
        <RefusalAlert refusal={refusal} />
      ) : null}
      {doc === undefined ? null : (
        <Card>
          <CardHeader className="flex flex-col gap-4">
            <CardTitle>
              <h1 className="text-xl font-semibold">
                {typeof heading === 'string'
                  ? heading
                  : singularHeading(collection.label)}
              </h1>
            </CardTitle>
            <Actions collection={collection} id={id} />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Tabs collection={collection} id={id} tab={tab} />
            {tab === undefined ? (
              <DocumentFields collection={collection} doc={doc} />
            ) : null}
            {tab !== undefined && relation === undefined ? (
              <NotFound what={`No relation "${tab}".`} />
            ) : null}
            {relation === undefined ? null : (
              <RelationTab
                // Each relation's tab starts over: its pages and its editor.
                key={relation.name}
                collection={collection}
                relation={relation}
                id={id}
                query={query}
                total={Array.isArray(links) ? links.length : undefined}
              />
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
