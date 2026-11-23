import { expect, it, vi } from 'vitest';

it('the README quick start runs, and prints the note it finished', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await import('./quickstart.js');
    expect(log.mock.calls).toEqual([[['Write the docs']]]);
  } finally {
    log.mockRestore();
  }
});
