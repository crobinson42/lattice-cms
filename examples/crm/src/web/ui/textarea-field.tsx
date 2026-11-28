import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import { Textarea } from '@shadalaya/react/textarea';
import { useId } from 'react';

/** A labelled multi-line text input in a form, with its error under it. */
export function TextAreaField({
  name,
  label,
  defaultValue,
  placeholder,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly placeholder?: string;
  readonly error: string | undefined;
}) {
  const id = useId();
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={name}
        rows={3}
        defaultValue={defaultValue}
        {...(placeholder === undefined ? {} : { placeholder })}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
