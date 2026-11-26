import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shadalaya/react/sheet';
import type { ValidationIssue } from '@ts-pf/contract';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useState,
} from 'react';
import type { ApiError } from '../api.js';

/** A form's values, read by field name: empty when the field is unset. */
export type FormValues<F extends string> = (field: F) => string;

/** What a form shows after a refusal: a message per field, and the rest. */
export type FormErrors<F extends string> = {
  readonly fields: Partial<Record<F, string>>;
  readonly form: string | undefined;
};

const noErrors = { fields: {}, form: undefined } as const;

/**
 * A `VALIDATION` refusal's issues, each at the field its path starts with.
 * An issue at no field of the form becomes the form's message.
 */
export function fieldErrors<F extends string>(
  issues: readonly ValidationIssue[],
  fields: readonly F[],
): FormErrors<F> {
  const byField: Partial<Record<F, string>> = {};
  const rest: string[] = [];
  for (const { path, message } of issues) {
    const field = fields.find((name) => name === path[0]);
    if (field === undefined) rest.push(message);
    else byField[field] ??= message;
  }
  return {
    fields: byField,
    form: rest.length === 0 ? undefined : rest.join(' '),
  };
}

// A FormSheet stays open while its form is sending.
const SendingContext = createContext<(sending: boolean) => void>(() => {});

/**
 * A form's submit: it reads the values, sends them, and shows the refusal,
 * if any, a `VALIDATION` issue at its field. `send` answers with the
 * refusal, or undefined.
 */
export function useFormSubmit<F extends string>(
  fields: readonly F[],
  send: (values: FormValues<F>) => Promise<ApiError | undefined>,
) {
  const [errors, setErrors] = useState<FormErrors<F>>(noErrors);
  const [pending, setPending] = useState(false);
  const setSending = useContext(SendingContext);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values: FormValues<F> = (field) => {
      const value = data.get(field);
      return typeof value === 'string' ? value : '';
    };
    setPending(true);
    setSending(true);
    const refusal = await send(values).finally(() => {
      setPending(false);
      setSending(false);
    });
    setErrors(
      refusal === undefined
        ? noErrors
        : refusal.code === 'VALIDATION'
          ? fieldErrors(refusal.data.issues, fields)
          : { fields: {}, form: refusal.message },
    );
  };
  return {
    errors,
    pending,
    onSubmit: (event: FormEvent<HTMLFormElement>) => void onSubmit(event),
  };
}

/** A form in a side sheet. It cannot be closed while the form is sending. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  const [sending, setSending] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!sending) onOpenChange(next);
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <SendingContext value={setSending}>{children}</SendingContext>
        </div>
      </SheetContent>
    </Sheet>
  );
}
