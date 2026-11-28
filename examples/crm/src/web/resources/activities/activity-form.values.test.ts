import { describe, expect, it } from 'vitest';
import {
  type ActivityField,
  logInput,
  patchOf,
  valuesOf,
} from './activity-form.values.js';

const call = {
  id: 'a1',
  organizationId: 'o1',
  authorId: 'ann',
  kind: 'call' as const,
  body: 'Discussed pricing.',
  // Seconds and milliseconds, which a datetime-local input does not show.
  occurredAt: '2026-11-25T14:30:45.123Z',
  dealId: { id: 'd1' },
  companyId: { id: 'c1' },
  createdAt: '2026-11-25T14:31:00.000Z',
  updatedAt: '2026-11-25T14:31:00.000Z',
};

/** The form as it reads after the activity's values, with some changed. */
const form =
  (changed: Partial<Record<ActivityField, string>>) => (field: ActivityField) =>
    changed[field] ?? valuesOf(call, new Date())(field);

describe('the activity form', () => {
  it('sends only the body when only the body changed', () => {
    expect(
      patchOf(call, form({ body: 'Discussed pricing and the pilot.' })),
    ).toEqual({
      body: 'Discussed pricing and the pilot.',
    });
    expect(patchOf(call, form({}))).toEqual({});
  });

  it('logs with its parents, and its time as ISO', () => {
    const input = logInput(
      form({ kind: 'note', body: 'Signed.', occurredAt: '2026-11-26T09:30' }),
      { dealId: 'd1', companyId: 'c1' },
    );
    expect(input).toMatchObject({
      kind: 'note',
      body: 'Signed.',
      dealId: 'd1',
      companyId: 'c1',
    });
    expect(input.occurredAt).toBe(new Date('2026-11-26T09:30').toISOString());
  });
});
