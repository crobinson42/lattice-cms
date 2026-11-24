import { Button } from '@shadalaya/react/button';
import { useState } from 'react';
import type { Collection } from './collections.js';
import { ConfirmDialog } from './confirm.js';
import { useCaller, useRevalidate } from './data.js';
import { type Refusal, refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { useRouter } from './router.js';

/**
 * Deletes the document after asking, then shows its collection's list. A
 * refusal stays on the page: REFERENCED says what still refers to it.
 */
export function DeleteAction({
  collection,
  id,
}: {
  readonly collection: Collection;
  readonly id: string;
}) {
  const { href, navigate } = useRouter();
  const call = useCaller();
  const revalidate = useRevalidate('drop');
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const procedure = collection.operations.delete;
  if (procedure === undefined) return null;
  const remove = async () => {
    setRefusal(undefined);
    try {
      await call(procedure, { id });
    } catch (error) {
      setRefusal(refusalOf(error));
      return;
    }
    // Emptied before the list mounts, and awaited after leaving, so the
    // deleted document's own refetch never shows on its page.
    const dropped = revalidate(collection);
    navigate(href(collection.slug));
    await dropped;
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="destructive"
        onClick={() => setAsking(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        confirmation={{
          title: `Delete this ${collection.label.singular}?`,
          description: 'It cannot be brought back.',
          action: 'Delete',
          destructive: true,
        }}
        open={asking}
        onOpenChange={setAsking}
        onConfirm={() => void remove()}
      />
      {refusal === undefined ? null : <RefusalAlert refusal={refusal} />}
    </div>
  );
}
