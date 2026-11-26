import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import { FieldGroup } from '@shadalaya/react/field';
import { useState } from 'react';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { TextField } from '../../ui/text-field.js';
import type { Member } from '../members/member.js';
import { MemberSelect } from '../members/member-select.js';
import { type ParentSearches, ParentSelect } from '../parent-select.js';
import { type Parent, parentsOf } from '../parents.js';
import type { Task, TaskCreate, TaskPatch } from './task.js';
import {
  createInput,
  patchOf,
  taskFields,
  valuesOf,
} from './task-form.values.js';

// A missing parent is refused at companyId: the parent picker shows it.
const names = [...taskFields.map(({ name }) => name), 'companyId'] as const;

/**
 * Creates a task on a record picked with ParentSelect, for `me` unless
 * another member is picked, or edits `task`. An edit keeps its parents.
 */
export function TaskForm(
  props: {
    readonly members: readonly Member[];
    /** The signed-in member's user id: a new task's assignee. */
    readonly me: string;
  } & (
    | {
        readonly task?: undefined;
        readonly searches: ParentSearches;
        readonly onSubmit: Submit<TaskCreate>;
      }
    | { readonly task: Task; readonly onSubmit: Submit<TaskPatch> }
  ),
) {
  const [parent, setParent] = useState<Parent>();
  const { errors, pending, onSubmit } = useFormSubmit(names, (values) =>
    props.task === undefined
      ? props.onSubmit(
          createInput(
            taskFields,
            values,
            parent === undefined ? {} : parentsOf(parent),
          ),
        )
      : props.onSubmit(patchOf(props.task, values)),
  );
  const initial = valuesOf(props.task, props.me);
  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup>
        {props.task === undefined ? (
          <ParentSelect
            searches={props.searches}
            error={errors.fields.companyId}
            onPick={setParent}
          />
        ) : null}
        {taskFields.map((field) => {
          const error = errors.fields[field.name];
          switch (field.widget) {
            case 'member':
              return (
                <MemberSelect
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  members={props.members}
                  defaultValue={initial(field.name)}
                  error={error}
                />
              );
            default:
              return (
                <TextField
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  type={field.widget}
                  defaultValue={initial(field.name)}
                  error={error}
                />
              );
          }
        })}
        {errors.form === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending}>
          {props.task === undefined ? 'Create task' : 'Save changes'}
        </Button>
      </FieldGroup>
    </form>
  );
}
