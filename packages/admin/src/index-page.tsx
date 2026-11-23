import { pluralHeading } from './labels.js';
import { useCollections } from './model.js';
import { Link, useRouter } from './router.js';

/** Every collection in the catalog, by its label. */
export function IndexPage() {
  const collections = useCollections();
  const { href } = useRouter();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Collections</h1>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((collection) => (
          <li key={collection.slug}>
            <Link
              className="block rounded-lg border p-4 font-medium hover:bg-muted"
              href={href(collection.slug)}
            >
              {pluralHeading(collection.label)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
