import { describe, expect, it } from 'vitest';
import { supportUserIds } from './support.js';

describe('supportUserIds', () => {
  it('reads a comma-separated list, trimmed, and none when unset', () => {
    expect([
      ...supportUserIds({ CRM_SUPPORT_USER_IDS: ' sam, ,tia ' }),
    ]).toEqual(['sam', 'tia']);
    expect(supportUserIds({}).size).toBe(0);
  });
});
