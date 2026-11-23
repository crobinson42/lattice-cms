import { createContext, type ReactNode, useContext } from 'react';
import type { Collection } from './collections.js';

const CollectionsContext = createContext<readonly Collection[]>([]);

/** The catalog's collections, for every page below. */
export function CollectionsProvider({
  collections,
  children,
}: {
  readonly collections: readonly Collection[];
  readonly children: ReactNode;
}) {
  return (
    <CollectionsContext value={collections}>{children}</CollectionsContext>
  );
}

export function useCollections(): readonly Collection[] {
  return useContext(CollectionsContext);
}

/** The collection with `slug`, if the catalog has it. */
export function useCollection(
  slug: string | undefined,
): Collection | undefined {
  const collections = useCollections();
  return collections.find((collection) => collection.slug === slug);
}
