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

/** Reads a field's text as the value the API takes. */
export type Parse<T> = (text: string) => T;

/** Text, as typed. */
export const text: Parse<string> = (typed) => typed;

/** A number. An empty field is not a number, for the server to refuse. */
export const number: Parse<number> = (typed) =>
  typed === '' ? Number.NaN : Number(typed);

/** An ISO date, as a date input gives it: "2026-12-01". */
export const isoDate: Parse<string> = (typed) => typed;

/**
 * An ISO date-time, from a datetime-local input's local time:
 * "2026-11-26T09:30" in the browser's time zone. At a daylight-saving
 * change, a skipped or repeated local hour is as the browser resolves it.
 * Anything that is not a date-time is sent as typed, for the server to
 * refuse at its field.
 */
export const isoDateTime: Parse<string> = (typed) => {
  const date = new Date(typed);
  return typed === '' || Number.isNaN(date.getTime())
    ? typed
    : date.toISOString();
};

/**
 * One of `values`, as a select of them gives it. A select offers nothing
 * else, so anything else is the first value.
 */
export function oneOf<const V extends string>(
  values: readonly [V, ...V[]],
): Parse<V> {
  return (typed) => values.find((value) => value === typed) ?? values[0];
}

/**
 * The fields of a form for input `I`, by name: each reads its text with a
 * parser of the field's own type, and only a field `I` lets be absent may
 * be `optional`. An optional field left empty is left out of a create, and
 * cleared with `null` in an edit. `widget` says how the form shows it.
 */
type Fields<I> = {
  [K in keyof I & string]-?: {
    readonly name: K;
    readonly label: string;
    readonly widget: string;
    readonly parse: Parse<NonNullable<I[K]>>;
    readonly optional?: undefined extends I[K] ? true : never;
  };
};

/** A field of a form for input `I`. */
export type FormField<
  I,
  K extends keyof I & string = keyof I & string,
> = Fields<I>[K];

/** Sets one field: its name and its parser's value have the same `K`. */
function put<I, K extends keyof I & string>(
  target: { [P in keyof I]?: I[P] | null },
  field: Fields<I>[K],
  typed: string,
): void {
  target[field.name] = field.parse(typed);
}

function clear<I, K extends keyof I & string>(
  target: { [P in keyof I]?: I[P] | null },
  field: Fields<I>[K],
): void {
  target[field.name] = null;
}

/**
 * Fills a create's input from the form, trimmed: every required field, and
 * each optional one that is not empty. `input` starts with the required
 * fields, which this overwrites.
 */
export function fillCreate<I, F extends keyof I & string>(
  input: { [P in keyof I]?: I[P] },
  fields: readonly FormField<I, F>[],
  values: FormValues<F>,
): void {
  for (const field of fields) {
    const typed = values(field.name).trim();
    if (field.optional !== true || typed !== '') put(input, field, typed);
  }
}

/**
 * Fills an edit's patch with what the form changed, both sides trimmed. A
 * cleared optional field is `null`, which removes it. An emptied required
 * field is sent, for the server to refuse at its field.
 */
export function fillPatch<I, F extends keyof I & string>(
  patch: { [P in keyof I]?: I[P] | null },
  fields: readonly FormField<I, F>[],
  before: FormValues<F>,
  values: FormValues<F>,
): void {
  for (const field of fields) {
    const typed = values(field.name).trim();
    if (typed === before(field.name).trim()) continue;
    if (field.optional === true && typed === '') clear(patch, field);
    else put(patch, field, typed);
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
