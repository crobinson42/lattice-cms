import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import { FieldGroup } from '@shadalaya/react/field';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { TextField } from '../../ui/text-field.js';
import type { Company, CompanyCreate, CompanyPatch } from './company.js';
import {
  companyFields,
  createInput,
  patchOf,
  valuesOf,
} from './company-form.values.js';

const names = companyFields.map(({ name }) => name);

/**
 * Creates a company, or edits `company`. The caller sends what the form
 * submits, and answers with the refusal, if any: the form shows it, a
 * `VALIDATION` issue at its field. The server validates: one set of rules,
 * and its messages at the fields.
 */
export function CompanyForm(
  props:
    | {
        readonly company?: undefined;
        readonly onSubmit: Submit<CompanyCreate>;
      }
    | { readonly company: Company; readonly onSubmit: Submit<CompanyPatch> },
) {
  const { errors, pending, onSubmit } = useFormSubmit(names, (values) =>
    props.company === undefined
      ? props.onSubmit(createInput(values))
      : props.onSubmit(patchOf(props.company, values)),
  );
  const initial = valuesOf(props.company);
  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup>
        {companyFields.map(({ name, label, type }) => (
          <TextField
            key={name}
            name={name}
            label={label}
            type={type}
            defaultValue={initial(name)}
            error={errors.fields[name]}
          />
        ))}
        {errors.form === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending}>
          {props.company === undefined ? 'Create company' : 'Save changes'}
        </Button>
      </FieldGroup>
    </form>
  );
}
