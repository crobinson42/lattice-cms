import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shadalaya/react/alert-dialog';

/** What a confirmation asks: a question, what follows, and the action. */
export type Confirmation = {
  readonly title: string;
  readonly description: string;
  readonly action: string;
  /** The action destroys data, so its button says so. */
  readonly destructive: boolean;
};

/** Asks before a call that changes data. Cancel closes it and does nothing. */
export function ConfirmDialog({
  confirmation,
  open,
  onOpenChange,
  onConfirm,
}: {
  readonly confirmation: Confirmation;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmation.destructive ? 'destructive' : 'default'}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmation.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
