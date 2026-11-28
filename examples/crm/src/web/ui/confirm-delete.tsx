import { Trash2Icon } from 'lucide-react';
import type { ApiError } from '../api.js';
import { ConfirmAction } from './confirm-action.js';

/** A slug in words, as a collection's default label reads it. */
function words(slug: string): string {
  return slug.replaceAll('_', ' ');
}

/**
 * Why a delete was refused, in words. A document that others point at:
 * "Acme still has contacts. Remove them first." One that is linked through
 * a relation, such as a contact on a deal: "Ana Diaz is still on deals.
 * Remove Ana Diaz from them first."
 */
export function deleteRefusal(name: string, error: ApiError): string {
  if (error.code !== 'REFERENCED') return error.message;
  const { relation, collection } = error.data.by;
  if (relation !== undefined) {
    return `${name} is still on ${words(relation.collection)}. Remove ${name} from them first.`;
  }
  return `${name} still has ${words(collection)}. Remove them first.`;
}

/**
 * A Delete button, and a dialog that asks first, open until the delete
 * settles, with a refusal in words. `onDelete` answers with the refusal, or
 * undefined.
 */
export function ConfirmDelete({
  name,
  consequence,
  onDelete,
}: {
  readonly name: string;
  /** What else goes, or that it cannot be undone. */
  readonly consequence: string;
  readonly onDelete: () => Promise<ApiError | undefined>;
}) {
  return (
    <ConfirmAction
      trigger={
        <>
          <Trash2Icon />
          Delete
        </>
      }
      variant="destructive"
      title={`Delete ${name}?`}
      description={consequence}
      confirm="Delete"
      pending="Deleting…"
      onConfirm={async () => {
        const error = await onDelete();
        return error === undefined ? undefined : deleteRefusal(name, error);
      }}
    />
  );
}
