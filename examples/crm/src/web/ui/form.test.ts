import { expect, it } from 'vitest';
import { fieldErrors } from './form.js';

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
