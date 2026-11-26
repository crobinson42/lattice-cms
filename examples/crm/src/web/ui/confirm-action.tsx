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
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * A button, and a dialog that asks before it acts. It stays open until the
 * action settles, and a refusal is shown in it, in words: `onConfirm`
 * answers with the refusal, or undefined.
 */
export function ConfirmAction({
  trigger,
  variant = 'default',
  title,
  description,
  confirm,
  pending: pendingLabel,
  onConfirm,
}: {
  /** The button's content: an icon and a word. */
  readonly trigger: ReactNode;
  readonly variant?: 'default' | 'outline' | 'destructive';
  readonly title: string;
  readonly description: string;
  /** The confirming button's word, and its word while it acts. */
  readonly confirm: string;
  readonly pending: string;
  readonly onConfirm: () => Promise<string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const close = useRef<HTMLButtonElement>(null);
  // The refusal takes the confirming button's place, and focus goes to Close.
  useEffect(() => {
    if (refusal !== undefined) close.current?.focus();
  }, [refusal]);
  const act = async () => {
    setPending(true);
    const refused = await onConfirm().finally(() => setPending(false));
    if (refused === undefined) setOpen(false);
    else setRefusal(refused);
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
      <AlertDialogTrigger render={<Button variant={variant} />}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => void act()}
            >
              {pending ? pendingLabel : confirm}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
