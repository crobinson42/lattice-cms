import { describe, expect, it } from 'vitest';
import {
  type FormField,
  fieldErrors,
  fillCreate,
  fillPatch,
  number,
  oneOf,
  text,
} from './form.js';

it('puts each issue at its field, and the rest on the form', () => {
  expect(
    fieldErrors(
      [
        { path: ['name'], message: 'Too short' },
        { path: ['name'], message: 'Second' },
        { path: ['domain', 0], message: 'Bad domain' },
        { path: [], message: 'Not allowed' },
        { path: ['organizationId'], message: 'Unknown' },
      ],
      ['name', 'domain'],
    ),
  ).toEqual({
    fields: { name: 'Too short', domain: 'Bad domain' },
    form: 'Not allowed Unknown',
  });
});

// As the contract types an input: an optional field's type says undefined.
type Input = {
  title: string;
  amount: number;
  stage?: 'lead' | 'won' | undefined;
  phone?: string | undefined;
};

const fields = [
  { name: 'title', label: 'Title', widget: 'text', parse: text },
  { name: 'amount', label: 'Amount', widget: 'number', parse: number },
  {
    name: 'stage',
    label: 'Stage',
    widget: 'stage',
    parse: oneOf(['lead', 'won']),
  },
  { name: 'phone', label: 'Phone', widget: 'tel', parse: text, optional: true },
] as const satisfies readonly FormField<Input>[];

type Name = (typeof fields)[number]['name'];
const form =
  (values: Partial<Record<Name, string>>) =>
  (field: Name): string =>
    values[field] ?? '';

describe('a form’s fields', () => {
  it('fill a create with each field parsed, and leave an empty optional one out', () => {
    const input: Input = { title: '', amount: 0 };
    fillCreate(
      input,
      fields,
      form({ title: ' Fuel ', amount: ' 1200 ', stage: 'won' }),
    );
    expect(input).toEqual({ title: 'Fuel', amount: 1200, stage: 'won' });
    const empty: Input = { title: '', amount: 0 };
    fillCreate(empty, fields, form({}));
    expect(empty.amount).toBeNaN();
    expect(empty).not.toHaveProperty('phone');
  });

  it('fill a patch with what changed, and null for a cleared optional field', () => {
    const before = form({ title: 'Fuel', amount: '1200', phone: '555 ' });
    const unchanged: { [K in keyof Input]?: Input[K] | null } = {};
    fillPatch(
      unchanged,
      fields,
      before,
      form({ title: ' Fuel', amount: '1200', phone: '555' }),
    );
    expect(unchanged).toEqual({});
    const patch: { [K in keyof Input]?: Input[K] | null } = {};
    fillPatch(patch, fields, before, form({ title: '', amount: '90' }));
    expect(patch).toEqual({ title: '', amount: 90, phone: null });
  });

  it('take a parser of the field’s own type, and optional only where the input allows it', () => {
    const textAsNumber = {
      name: 'title',
      label: 'T',
      widget: 't',
      parse: number,
    } as const;
    // @ts-expect-error a number parser on a text field
    const wrongParser: FormField<Input> = textAsNumber;
    const optionalAmount = {
      name: 'amount',
      label: 'A',
      widget: 'n',
      parse: number,
      optional: true,
    } as const;
    // @ts-expect-error a required field cannot be optional
    const wrongOptional: FormField<Input> = optionalAmount;
    expect([wrongParser, wrongOptional]).toHaveLength(2);
  });
});
