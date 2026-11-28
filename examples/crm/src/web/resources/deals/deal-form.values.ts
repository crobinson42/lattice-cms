import {
  type FormField,
  type FormValues,
  fillCreate,
  fillPatch,
  isoDate,
  number,
  oneOf,
  text,
} from '../../ui/form.js';
import type { DealCreate, DealPatch, DealWithCompany } from './deal.js';
import { openStages } from './deal-stages.js';

/**
 * The form's fields, in its order, each typed by what a create takes. The
 * company and the owner are picked, and the stage is one of the open ones:
 * a deal closes through its Won and Lost buttons.
 */
export const dealFields = [
  { name: 'title', label: 'Title', widget: 'text', parse: text },
  { name: 'companyId', label: 'Company', widget: 'company', parse: text },
  { name: 'amount', label: 'Amount', widget: 'number', parse: number },
  {
    name: 'stage',
    label: 'Stage',
    widget: 'stage',
    parse: oneOf(openStages),
  },
  {
    name: 'ownerId',
    label: 'Owner',
    widget: 'member',
    parse: text,
    optional: true,
  },
  {
    name: 'expectedCloseDate',
    label: 'Expected close',
    widget: 'date',
    parse: isoDate,
    optional: true,
  },
] as const satisfies readonly FormField<DealCreate>[];

export type DealField = (typeof dealFields)[number]['name'];

/**
 * The fields a form shows. A member who does not read amounts sets one on
 * create, blind, but an edit cannot name it: the patch would be refused.
 */
export function dealFieldsFor(
  readsAmounts: boolean,
  mode: 'create' | 'edit',
): readonly (typeof dealFields)[number][] {
  return readsAmounts || mode === 'create'
    ? dealFields
    : dealFields.filter(({ name }) => name !== 'amount');
}

/** The form's starting values: the deal's, or a new lead. */
export function valuesOf(
  deal: DealWithCompany | undefined,
): FormValues<DealField> {
  return (field) => {
    switch (field) {
      case 'companyId':
        return deal?.companyId.id ?? '';
      case 'amount':
        return deal?.amount === undefined ? '' : String(deal.amount);
      case 'stage':
        return deal?.stage ?? 'lead';
      default:
        return deal?.[field] ?? '';
    }
  };
}

/** A new deal from the form. */
export function createInput(
  fields: readonly (typeof dealFields)[number][],
  values: FormValues<DealField>,
): DealCreate {
  const input: DealCreate = { title: '', companyId: '', amount: Number.NaN };
  fillCreate(input, fields, values);
  return input;
}

/** Only what the form changed, of the fields it showed. */
export function patchOf(
  deal: DealWithCompany,
  fields: readonly (typeof dealFields)[number][],
  values: FormValues<DealField>,
): DealPatch {
  const patch: DealPatch = {};
  fillPatch(patch, fields, valuesOf(deal), values);
  return patch;
}
