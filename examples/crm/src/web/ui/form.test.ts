import { expect, it } from 'vitest';
import { fieldErrors, fillCreate, fillPatch } from './form.js';

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

const fields = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel', optional: true },
  { name: 'title', label: 'Title', type: 'text', optional: true },
] as const;
type Field = (typeof fields)[number]['name'];
const form =
  (values: Partial<Record<Field, string>>) =>
  (field: Field): string =>
    values[field] ?? '';

it('fills a create with every required field and each optional one given', () => {
  const input: Partial<Record<Field, string>> = {};
  fillCreate(input, fields, form({ name: ' Ana ', title: ' CTO ' }));
  expect(input).toEqual({ name: 'Ana', title: 'CTO' });
  const empty: Partial<Record<Field, string>> = {};
  fillCreate(empty, fields, form({}));
  expect(empty).toEqual({ name: '' });
});

it('fills a patch with what changed, and null for a cleared optional field', () => {
  const before = form({ name: 'Ana', phone: '555 ', title: 'CTO' });
  const unchanged: Partial<Record<Field, string | null>> = {};
  fillPatch(
    unchanged,
    fields,
    before,
    form({ name: ' Ana', phone: '555', title: 'CTO' }),
  );
  expect(unchanged).toEqual({});
  const patch: Partial<Record<Field, string | null>> = {};
  fillPatch(patch, fields, before, form({ name: '', phone: '', title: 'CEO' }));
  expect(patch).toEqual({ name: '', phone: null, title: 'CEO' });
});
