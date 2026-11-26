import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { useId } from 'react';

/** One choice of a SelectField: what it submits, and what it says. */
export type SelectOption = { readonly value: string; readonly label: string };

/** A labelled select in a form, for a short list, with its error under it. */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly defaultValue: string;
  readonly error: string | undefined;
}) {
  const id = useId();
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="w-full"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      >
        {options.map(({ value, label }) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
