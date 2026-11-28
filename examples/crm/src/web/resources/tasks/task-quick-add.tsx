import { Button } from '@shadalaya/react/button';
import { PlusIcon } from 'lucide-react';
import { useRef } from 'react';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { TextField } from '../../ui/text-field.js';
import { type Parent, parentsOf } from '../parents.js';
import type { TaskCreate } from './task.js';
import { createInput, quickFields } from './task-form.values.js';

/**
 * Adds a task to a record in one line: a title and an optional due date,
 * on `parent` by the rule, for the signed-in member. After an add the
 * fields empty and the title keeps focus, for the next one.
 */
export function TaskQuickAdd({
  parent,
  me,
  onSubmit,
}: {
  readonly parent: Parent;
  readonly me: string;
  readonly onSubmit: Submit<TaskCreate>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const {
    errors,
    pending,
    onSubmit: submit,
  } = useFormSubmit(
    quickFields.map(({ name }) => name),
    async (values) => {
      const refusal = await onSubmit(
        createInput(quickFields, values, parentsOf(parent), { assigneeId: me }),
      );
      if (refusal === undefined) {
        form.current?.reset();
        form.current?.querySelector<HTMLInputElement>('input')?.focus();
      }
      return refusal;
    },
  );
  return (
    <form
      ref={form}
      noValidate
      onSubmit={submit}
      aria-label="Add a task"
      className="flex flex-wrap items-start gap-2"
    >
      {quickFields.map((field) => (
        <div
          key={field.name}
          className={field.name === 'title' ? 'min-w-48 flex-1' : 'w-44'}
        >
          <TextField
            name={field.name}
            label={field.name === 'title' ? 'New task' : field.label}
            type={field.widget}
            defaultValue=""
            error={errors.fields[field.name]}
          />
        </div>
      ))}
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="mt-7"
      >
        <PlusIcon />
        Add
      </Button>
      {errors.form === undefined ? null : (
        <p role="alert" className="w-full text-sm text-destructive">
          {errors.form}
        </p>
      )}
    </form>
  );
}
