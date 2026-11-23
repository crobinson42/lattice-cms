import { isRecord } from './catalog.js';
import type { Collection } from './collections.js';
import { useCall, useCaller, useRevalidate } from './data.js';
import { draftsOf, InputForm, inputFieldsOf } from './form.js';
import { pluralHeading, singularHeading } from './labels.js';
import { refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { Link, useRouter } from './router.js';
import { Loading, NotFound } from './states.js';

/** A heading with a link back to where the user came from. */
function WriteHeader({
  back,
  backText,
  title,
}: {
  readonly back: string;
  readonly backText: string;
  readonly title: string;
}) {
  return (
    <header className="flex flex-col gap-2">
      <Link
        className="text-sm text-muted-foreground hover:underline"
        href={back}
      >
        ← {backText}
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
    </header>
  );
}

/** A new document: create's input, then the document it made. */
export function CreatePage({
  collection,
}: {
  readonly collection: Collection;
}) {
  const { href, navigate } = useRouter();
  const call = useCaller();
  const revalidate = useRevalidate();
  const { create } = collection.operations;
  const singular = singularHeading(collection.label);
  if (create === undefined) {
    return (
      <NotFound
        what={`${pluralHeading(collection.label)} cannot be created here.`}
      />
    );
  }
  const fields = inputFieldsOf(create.input, []);
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <WriteHeader
        back={href(collection.slug)}
        backText={pluralHeading(collection.label)}
        title={`New ${collection.label.singular}`}
      />
      <InputForm
        label={`New ${collection.label.singular}`}
        fields={fields}
        initial={draftsOf(fields, {})}
        submitLabel={`Create ${singular.toLowerCase()}`}
        onSubmit={async (body) => {
          const doc = await call(create, body);
          await revalidate(collection);
          const id = isRecord(doc) ? doc.id : undefined;
          navigate(
            typeof id === 'string'
              ? href(collection.slug, id)
              : href(collection.slug),
          );
        }}
      />
    </section>
  );
}

/**
 * A document's edit: update's input, filled from get. It sends only what
 * changed, and a field the caller did not receive is not in the form, so a
 * withheld value is never sent back.
 */
export function EditPage({
  collection,
  id,
}: {
  readonly collection: Collection;
  readonly id: string;
}) {
  const { href, navigate } = useRouter();
  const call = useCaller();
  const revalidate = useRevalidate();
  const { get, update } = collection.operations;
  // The detail page's call, so the document is already cached.
  const { data, error, isLoading } = useCall(get, {
    id,
    populate: get?.expand ?? [],
  });
  const detail = href(collection.slug, id);
  if (update === undefined) {
    return (
      <NotFound
        what={`${pluralHeading(collection.label)} cannot be edited here.`}
      />
    );
  }
  if (error !== undefined) {
    const refusal = refusalOf(error);
    return refusal.code === 'NOT_FOUND' ? (
      <NotFound what={`No ${collection.label.singular} with id ${id}.`} />
    ) : (
      <RefusalAlert refusal={refusal} />
    );
  }
  if (isLoading || !isRecord(data)) return <Loading />;
  const withheld = (name: string) =>
    data[name] === undefined &&
    collection.fields.some((field) => field.name === name && field.maskable);
  const fields = inputFieldsOf(update.input, ['id']).filter(
    (field) => !withheld(field.name),
  );
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <WriteHeader
        back={detail}
        backText={singularHeading(collection.label)}
        title={`Edit ${collection.label.singular}`}
      />
      <InputForm
        label={`Edit ${collection.label.singular}`}
        fields={fields}
        initial={draftsOf(fields, data)}
        submitLabel="Save"
        onSubmit={async (body) => {
          if (Object.keys(body).length > 0) {
            await call(update, { id, ...body });
            await revalidate(collection);
          }
          navigate(detail);
        }}
      />
    </section>
  );
}
