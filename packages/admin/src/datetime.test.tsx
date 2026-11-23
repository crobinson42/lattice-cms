import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { open, seeded } from './test/screen.js';

// A zone with a daylight-saving change, so winter and summer differ: a
// datetime-local input is local time, and the server gets ISO in UTC.
process.env.TZ = 'America/New_York';

afterEach(cleanup);

it('shows a date and time in local time, and sends it as UTC', async () => {
  const { app, big } = await seeded();
  await app.repos.deals.update(
    big.id,
    { closesAt: '2026-03-01T15:30:00.000Z' },
    app.scope.deals,
  );
  open(`/admin/deals/${big.id}/edit`, app.fetch);
  await screen.findByRole('heading', { name: 'Edit deal' });
  // 15:30 UTC is 10:30 in New York in winter (UTC-5).
  expect(screen.getByDisplayValue('2026-03-01T10:30')).toBe(
    screen.getByLabelText('Closes at'),
  );

  // 09:00 in New York in summer (UTC-4) is 13:00 UTC.
  fireEvent.change(screen.getByLabelText('Closes at'), {
    target: { value: '2026-07-04T09:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(app.sentTo('/rpc/deals/update')).toEqual([
      { id: big.id, closesAt: '2026-07-04T13:00:00.000Z' },
    ]),
  );
});
