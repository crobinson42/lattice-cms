import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
  isoDate,
  text,
} from '../../ui/form.js';
import type { Parents } from '../parents.js';
import type { Task, TaskCreate, TaskPatch } from './task.js';

/** The form's fields, in its order, each typed by what a create takes. */
export const taskFields = [
  { name: 'title', label: 'Title', widget: 'text', parse: text },
  {
    name: 'dueDate',
    label: 'Due',
    widget: 'date',
    parse: isoDate,
    optional: true,
  },
  {
    name: 'assigneeId',
    label: 'Assignee',
    widget: 'member',
    parse: text,
    optional: true,
  },
] as const satisfies readonly FormField<TaskCreate>[];

/** A quick add's fields: a title and a due date, for the signed-in member. */
export const quickFields = [taskFields[0], taskFields[1]] as const;

export type TaskField = (typeof taskFields)[number]['name'];

/** The form's starting values: the task's, or a new one for `me`. */
export function valuesOf(
  task: Task | undefined,
  me: string,
): FormValues<TaskField> {
  return (field) => {
    switch (field) {
      case 'assigneeId':
        return task === undefined ? me : (task.assigneeId ?? '');
      default:
        return task?.[field] ?? '';
    }
  };
}

/**
 * A new task from the form's `fields`, on `parents` by the rule. What the
 * form does not show, such as a quick add's assignee, comes from `base`.
 */
export function createInput<F extends TaskField>(
  fields: readonly FormField<TaskCreate, F>[],
  values: FormValues<F>,
  parents: Parents,
  base: Partial<TaskCreate> = {},
): TaskCreate {
  const input: TaskCreate = { title: '', ...base, ...parents };
  fillCreate(input, fields, values);
  return input;
}

/** Only what the form changed. */
export function patchOf(task: Task, values: FormValues<TaskField>): TaskPatch {
  const patch: TaskPatch = {};
  fillPatch(patch, taskFields, valuesOf(task, ''), values);
  return patch;
}
