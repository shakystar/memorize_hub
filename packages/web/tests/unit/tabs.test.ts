import { describe, expect, it } from 'vitest';

import { isTab } from '../../src/lib/tabs';

describe('isTab', () => {
  it('accepts every real tab, including connect', () => {
    for (const t of ['timeline', 'tasks', 'talk', 'decisions', 'sources', 'connect']) {
      expect(isTab(t)).toBe(true);
    }
  });

  it('rejects unknown, null, undefined', () => {
    expect(isTab('bogus')).toBe(false);
    expect(isTab(null)).toBe(false);
    expect(isTab(undefined)).toBe(false);
  });
});
