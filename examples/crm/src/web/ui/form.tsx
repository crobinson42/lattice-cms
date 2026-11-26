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

/** Sends a form's input, and answers with the refusal, if any. */
export type Submit<I> = (input: I) => Promise<ApiError | undefined>;

/**
 * A field of a resource's form: its name, label and input type. An
 * `optional` field may be left empty: a create leaves it out, and an edit
 * clears it with `null`.
 */
export type FormField<N extends string = string> = {
  readonly name: N;
  readonly label: string;
  readonly type: string;
  readonly optional?: true;
};

/**
 * Fills a create's input from the form, trimmed: every required field, and
 * each optional one that is not empty. `input` starts with the required
 * fields, which this overwrites.
 */
export function fillCreate<F extends string>(
  input: { [K in F]?: string | undefined },
  fields: readonly FormField<F>[],
  values: FormValues<F>,
): void {
  for (const { name, optional } of fields) {
    const value = values(name).trim();
    if (optional !== true || value !== '') input[name] = value;
  }
}

/**
 * Fills an edit's patch with what the form changed, both sides trimmed. A
 * cleared optional field is `null`, which removes it. An emptied required
 * field is sent, for the server to refuse at its field.
 */
export function fillPatch<F extends string>(
  patch: { [K in F]?: string | null | undefined },
  fields: readonly FormField<F>[],
  before: FormValues<F>,
  values: FormValues<F>,
): void {
  for (const { name, optional } of fields) {
    const value = values(name).trim();
    if (value === before(name).trim()) continue;
    patch[name] = optional === true && value === '' ? null : value;
  }
}

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
