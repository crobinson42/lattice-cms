import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import { FieldGroup } from '@shadalaya/react/field';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { TextField } from '../../ui/text-field.js';
import {
  type CompanyOption,
  CompanySelect,
  companyOption,
} from '../companies/company-select.js';
import type {
  ContactCreate,
  ContactPatch,
  ContactWithCompany,
} from './contact.js';
import {
  contactFields,
  createInput,
  patchOf,
  valuesOf,
} from './contact-form.values.js';

const names = contactFields.map(({ name }) => name);

/**
 * Creates a contact, at `company` when given, or edits `contact`. The
 * company is picked with CompanySelect, over `searchCompanies`. The caller
 * sends what the form submits, and answers with the refusal, if any.
 */
export function ContactForm(
  props: {
    readonly searchCompanies: (
      query: string,
      signal: AbortSignal,
    ) => Promise<readonly CompanyOption[]>;
  } & (
    | {
        readonly contact?: undefined;
        readonly company?: CompanyOption;
        readonly onSubmit: Submit<ContactCreate>;
      }
    | {
        readonly contact: ContactWithCompany;
        readonly onSubmit: Submit<ContactPatch>;
      }
  ),
) {
  const { errors, pending, onSubmit } = useFormSubmit(names, (values) =>
    props.contact === undefined
      ? props.onSubmit(createInput(values))
      : props.onSubmit(patchOf(props.contact, values)),
  );
  const initial = valuesOf(props.contact);
  const company =
    props.contact === undefined
      ? (props.company ?? null)
      : companyOption(props.contact.companyId);
  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup>
        {contactFields.map((field) =>
          field.type === 'company' ? (
            <CompanySelect
              key={field.name}
              name={field.name}
              defaultValue={company}
              search={props.searchCompanies}
              error={errors.fields[field.name]}
            />
          ) : (
            <TextField
              key={field.name}
              name={field.name}
              label={field.label}
              type={field.type}
              defaultValue={initial(field.name)}
              error={errors.fields[field.name]}
            />
          ),
        )}
        {errors.form === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending}>
          {props.contact === undefined ? 'Create contact' : 'Save changes'}
        </Button>
      </FieldGroup>
    </form>
  );
}
