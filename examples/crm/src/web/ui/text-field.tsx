import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import { Input } from '@shadalaya/react/input';
import { useId } from 'react';

/** A labelled text input in a form, with its error under it. */
export function TextField({
  name,
  label,
  type = 'text',
  defaultValue,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'tel' | 'email' | 'number' | 'date';
  readonly defaultValue: string;
  readonly error: string | undefined;
}) {
  const id = useId();
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
