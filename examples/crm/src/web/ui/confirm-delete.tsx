import { Alert, AlertDescription } from '@shadalaya/react/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shadalaya/react/alert-dialog';
import { Button } from '@shadalaya/react/button';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../api.js';

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
 * A Delete button, and a dialog that asks first. It stays open until the
 * delete settles, and a refusal is shown in it, in words. `onDelete`
 * answers with the refusal, or undefined.
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
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const close = useRef<HTMLButtonElement>(null);
  // The refusal takes the Delete button's place, and focus goes to Close.
  useEffect(() => {
    if (refusal !== undefined) close.current?.focus();
  }, [refusal]);
  const confirm = async () => {
    setPending(true);
    const error = await onDelete().finally(() => setPending(false));
    if (error === undefined) setOpen(false);
    else setRefusal(deleteRefusal(name, error));
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setRefusal(undefined);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <Trash2Icon />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={close} disabled={pending}>
            {refusal === undefined ? 'Cancel' : 'Close'}
          </AlertDialogCancel>
          {refusal === undefined ? (
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
