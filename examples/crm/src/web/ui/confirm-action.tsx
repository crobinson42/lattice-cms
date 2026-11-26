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
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * A dialog that asks before it acts, and the button that opens it. It
 * stays open until the action settles, and a refusal is shown in it, in
 * words: `onConfirm` answers with the refusal, or undefined. Given `open`,
 * the caller opens it, such as from a menu item, and there is no button.
 */
export function ConfirmAction({
  title,
  description,
  confirm,
  pending: pendingLabel,
  onConfirm,
  variant = 'default',
  size,
  finalFocus,
  ...opener
}: {
  readonly title: string;
  readonly description: string;
  /** The confirming button's word, and its word while it acts. */
  readonly confirm: string;
  readonly pending: string;
  readonly onConfirm: () => Promise<string | undefined>;
  readonly variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  readonly size?: ComponentProps<typeof Button>['size'];
  /** Where focus goes when it closes, such as the menu button it came from. */
  readonly finalFocus?: RefObject<HTMLElement | null>;
} & (
  | {
      /** The button's content: an icon and a word. */
      readonly trigger: ReactNode;
    }
  | { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }
)) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = 'open' in opener ? opener.open : ownOpen;
  const setOpen = 'open' in opener ? opener.onOpenChange : setOwnOpen;
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
      {'trigger' in opener ? (
        <AlertDialogTrigger
          render={
            <Button
              variant={variant}
              {...(size === undefined ? {} : { size })}
            />
          }
        >
          {opener.trigger}
        </AlertDialogTrigger>
      ) : null}
      <AlertDialogContent {...(finalFocus === undefined ? {} : { finalFocus })}>
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
