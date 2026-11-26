import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
  isoDateTime,
  text,
} from '../../ui/form.js';
import { toLocalInput } from '../../ui/format.js';
import type { Parents } from '../parents.js';
import type { Activity, ActivityLog, ActivityPatch } from './activity.js';
import { parseKind } from './activity-kinds.js';

/** The form's fields, in its order, each typed by what logging takes. */
export const activityFields = [
  { name: 'kind', label: 'Kind', widget: 'kind', parse: parseKind },
  { name: 'body', label: 'What happened', widget: 'textarea', parse: text },
  {
    name: 'occurredAt',
    label: 'When',
    widget: 'datetime-local',
    parse: isoDateTime,
  },
] as const satisfies readonly FormField<ActivityLog>[];

export type ActivityField = (typeof activityFields)[number]['name'];

/** The form's starting values: the activity's, or a note, now. */
export function valuesOf(
  activity: Activity | undefined,
  now: Date,
): FormValues<ActivityField> {
  return (field) => {
    switch (field) {
      case 'kind':
        return activity?.kind ?? 'note';
      case 'body':
        return activity?.body ?? '';
      case 'occurredAt':
        return toLocalInput(activity?.occurredAt ?? now.toISOString());
    }
  };
}

/** A new activity from the form, with its parents by the rule. */
export function logInput(
  values: FormValues<ActivityField>,
  parents: Parents,
): ActivityLog {
  const input: ActivityLog = {
    kind: 'note',
    body: '',
    occurredAt: '',
    ...parents,
  };
  fillCreate(input, activityFields, values);
  return input;
}

/** Only what the form changed. */
export function patchOf(
  activity: Activity,
  values: FormValues<ActivityField>,
): ActivityPatch {
  const patch: ActivityPatch = {};
  fillPatch(patch, activityFields, valuesOf(activity, new Date()), values);
  return patch;
}
