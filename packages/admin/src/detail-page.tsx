import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@shadalaya/react/card';
import { isRecord } from './catalog.js';
import { type Collection, type Relation, titleFieldOf } from './collections.js';
import { useCall } from './data.js';
import {
  fieldLabel,
  pluralHeading,
  relationLabel,
  singularHeading,
} from './labels.js';
import { refusalOf } from './refusal.js';
import { Link, useRouter } from './router.js';
import type { Field } from './schema.js';
import { Loading, NotFound, RefusalAlert } from './states.js';
import { FieldValue, RefValue } from './value.js';

/** Fields as label and value rows. */
function FieldList({
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

/** A populated relation: each link's target document, and its fields. */
function RelationLinks({
  relation,
  links,
}: {
  readonly relation: Relation;
  readonly links: readonly Record<string, unknown>[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-medium">{relationLabel(relation.name)}</h2>
      {links.length === 0 ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => {
            const { doc, ...fields } = link;
            const id = isRecord(doc) ? doc.id : undefined;
            return (
              <li key={typeof id === 'string' ? id : JSON.stringify(link)}>
                <RefValue target={relation.target} value={doc} />
                {Object.entries(fields)
                  .filter(
                    ([, value]) =>
                      typeof value === 'string' || typeof value === 'number',
                  )
                  .map(([name, value]) => (
                    <span key={name} className="text-muted-foreground">
                      {' · '}
                      {String(value)}
                    </span>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One document, read-only: its fields, its populated refs and relations as
 * links, then the system fields. A field the caller may not read is absent.
 */
function DocumentView({
  collection,
  doc,
}: {
  readonly collection: Collection;
  readonly doc: Record<string, unknown>;
}) {
  const title = titleFieldOf(collection);
  const heading = title === undefined ? undefined : doc[title.name];
  const shown = collection.fields.filter(
    (field) => !(field.maskable && doc[field.name] === undefined),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold">
            {typeof heading === 'string'
              ? heading
              : singularHeading(collection.label)}
          </h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldList fields={shown.filter((field) => !field.system)} doc={doc} />
        {collection.relations.map((relation) => {
          const links = doc[relation.name];
          return Array.isArray(links) ? (
            <RelationLinks
              key={relation.name}
              relation={relation}
              links={links.filter(isRecord)}
            />
          ) : null;
        })}
        <section aria-label="System fields">
          <FieldList fields={shown.filter((field) => field.system)} doc={doc} />
        </section>
      </CardContent>
    </Card>
  );
}

/** A document's page: `get` with every field `populate` takes. */
export function DetailPage({
  collection,
  id,
}: {
  readonly collection: Collection;
  readonly id: string;
}) {
  const { href } = useRouter();
  const { get } = collection.operations;
  const { data, error, isLoading } = useCall(get, {
    id,
    populate: get?.expand ?? [],
  });
  const refusal = error === undefined ? undefined : refusalOf(error);
  const what = `No ${collection.label.singular} with id ${id}.`;
  return (
    <section className="flex flex-col gap-4">
      <Link
        className="text-sm text-muted-foreground hover:underline"
        href={href(collection.slug)}
      >
        ← {pluralHeading(collection.label)}
      </Link>
      {isLoading ? <Loading /> : null}
      {refusal?.code === 'NOT_FOUND' ? <NotFound what={what} /> : null}
      {refusal !== undefined && refusal.code !== 'NOT_FOUND' ? (
        <RefusalAlert refusal={refusal} />
      ) : null}
      {isRecord(data) ? (
        <DocumentView collection={collection} doc={data} />
      ) : null}
    </section>
  );
}
