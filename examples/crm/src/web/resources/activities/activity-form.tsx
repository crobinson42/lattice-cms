import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import { FieldGroup } from '@shadalaya/react/field';
import { useEffect, useRef } from 'react';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { SelectField } from '../../ui/select-field.js';
import { TextField } from '../../ui/text-field.js';
import { TextAreaField } from '../../ui/textarea-field.js';
import type {
  Activity,
  ActivityLog,
  ActivityParents,
  ActivityPatch,
} from './activity.js';
import {
  activityFields,
  logInput,
  patchOf,
  valuesOf,
} from './activity-form.values.js';
import { kindOptions } from './activity-kinds.js';

const names = activityFields.map(({ name }) => name);

/**
 * Logs an activity on `parents`, or edits `activity`: its kind, what
 * happened, and when, now unless changed. The caller sends what the form
 * submits, and answers with the refusal, if any.
 */
export function ActivityForm(
  props: {
    readonly onCancel?: () => void;
    /** Focus the first field when it opens, as the composer does. */
    readonly focusFirst?: boolean;
  } & (
    | {
        readonly activity?: undefined;
        readonly parents: ActivityParents;
        readonly onSubmit: Submit<ActivityLog>;
      }
    | { readonly activity: Activity; readonly onSubmit: Submit<ActivityPatch> }
  ),
) {
  const { errors, pending, onSubmit } = useFormSubmit(names, (values) =>
    props.activity === undefined
      ? props.onSubmit(logInput(values, props.parents))
      : props.onSubmit(patchOf(props.activity, values)),
  );
  const initial = valuesOf(props.activity, new Date());
  const form = useRef<HTMLFormElement>(null);
  const { focusFirst } = props;
  useEffect(() => {
    if (focusFirst === true) {
      form.current
        ?.querySelector<HTMLElement>('select, input, textarea')
        ?.focus();
    }
  }, [focusFirst]);
  return (
    <form ref={form} noValidate onSubmit={onSubmit}>
      <FieldGroup>
        {activityFields.map((field) => {
          const error = errors.fields[field.name];
          switch (field.widget) {
            case 'kind':
              return (
                <SelectField
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  options={kindOptions}
                  defaultValue={initial(field.name)}
                  error={error}
                />
              );
            case 'textarea':
              return (
                <TextAreaField
                  key={field.name}
                  name={field.name}
                  label={field.label}
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
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {props.activity === undefined ? 'Log activity' : 'Save changes'}
          </Button>
          {props.onCancel === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={props.onCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}
