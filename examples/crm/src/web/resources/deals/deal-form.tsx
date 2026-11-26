import { Alert, AlertDescription } from '@shadalaya/react/alert';
import { Button } from '@shadalaya/react/button';
import { FieldDescription, FieldGroup } from '@shadalaya/react/field';
import { type Submit, useFormSubmit } from '../../ui/form.js';
import { SelectField } from '../../ui/select-field.js';
import { TextField } from '../../ui/text-field.js';
import {
  type CompanyOption,
  CompanySelect,
  companyOption,
} from '../companies/company-select.js';
import type { Member } from '../members/member.js';
import { MemberSelect } from '../members/member-select.js';
import type { DealCreate, DealPatch, DealWithCompany } from './deal.js';
import {
  createInput,
  dealFieldsFor,
  patchOf,
  valuesOf,
} from './deal-form.values.js';
import { dealStages, openStages } from './deal-stages.js';

const stageOptions = openStages.map((stage) => ({
  value: stage,
  label: dealStages[stage].label,
}));

/**
 * Creates a deal, at `company` when given, or edits `deal`. The company is
 * picked with CompanySelect, the owner from `members`. A member who does
 * not read amounts sets one on create, and is told they will not see it.
 */
export function DealForm(
  props: {
    readonly members: readonly Member[];
    readonly readsAmounts: boolean;
    readonly searchCompanies: (
      query: string,
      signal: AbortSignal,
    ) => Promise<readonly CompanyOption[]>;
  } & (
    | {
        readonly deal?: undefined;
        readonly company?: CompanyOption;
        readonly onSubmit: Submit<DealCreate>;
      }
    | { readonly deal: DealWithCompany; readonly onSubmit: Submit<DealPatch> }
  ),
) {
  const fields = dealFieldsFor(
    props.readsAmounts,
    props.deal === undefined ? 'create' : 'edit',
  );
  const { errors, pending, onSubmit } = useFormSubmit(
    fields.map(({ name }) => name),
    (values) =>
      props.deal === undefined
        ? props.onSubmit(createInput(fields, values))
        : props.onSubmit(patchOf(props.deal, fields, values)),
  );
  const initial = valuesOf(props.deal);
  const company =
    props.deal === undefined
      ? (props.company ?? null)
      : companyOption(props.deal.companyId);
  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup>
        {fields.map((field) => {
          const error = errors.fields[field.name];
          switch (field.widget) {
            case 'company':
              return (
                <CompanySelect
                  key={field.name}
                  name={field.name}
                  defaultValue={company}
                  search={props.searchCompanies}
                  error={error}
                />
              );
            case 'stage':
              return (
                <SelectField
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  options={stageOptions}
                  defaultValue={initial(field.name)}
                  error={error}
                />
              );
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
                <div key={field.name}>
                  <TextField
                    name={field.name}
                    label={field.label}
                    type={field.widget}
                    defaultValue={initial(field.name)}
                    error={error}
                  />
                  {field.name === 'amount' && !props.readsAmounts ? (
                    <FieldDescription className="mt-1">
                      Only managers see amounts: you will not see it after
                      saving.
                    </FieldDescription>
                  ) : null}
                </div>
              );
          }
        })}
        {errors.form === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending}>
          {props.deal === undefined ? 'Create deal' : 'Save changes'}
        </Button>
      </FieldGroup>
    </form>
  );
}
