import { describe, expect, it } from 'vitest';

import type { TimelineItem } from '../../src/lib/domain';
import { compareItems, mergeOlderPage } from '../../src/lib/timeline-page';

function mem(id: string, at: string): TimelineItem {
  return { id, at, type: 'memory.consolidated', kind: 'progress', text: id, salience: 5, member: 'a@x' };
}

describe('timeline-page', () => {
  it('orders by (at, id) ascending', () => {
    const a = mem('m1', '2026-07-03T00:01:00.000Z');
    const b = mem('m2', '2026-07-03T00:02:00.000Z');
    expect(compareItems(a, b)).toBeLessThan(0);
    const tieLo = mem('m1', '2026-07-03T00:01:00.000Z');
    const tieHi = mem('m2', '2026-07-03T00:01:00.000Z');
    expect(compareItems(tieLo, tieHi)).toBeLessThan(0);
  });

  it('prepends an older page and keeps ascending order', () => {
    const existing = [mem('m3', '2026-07-03T00:03:00.000Z'), mem('m4', '2026-07-03T00:04:00.000Z')];
    const older = [mem('m1', '2026-07-03T00:01:00.000Z'), mem('m2', '2026-07-03T00:02:00.000Z')];
    expect(mergeOlderPage(existing, older).map((i) => i.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('dedups by id, existing wins', () => {
    const existing = [mem('m2', '2026-07-03T00:02:00.000Z'), mem('m3', '2026-07-03T00:03:00.000Z')];
    const older = [mem('m1', '2026-07-03T00:01:00.000Z'), mem('m2', '2026-07-03T00:02:00.000Z')];
    const merged = mergeOlderPage(existing, older);
    expect(merged.map((i) => i.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged.filter((i) => i.id === 'm2')).toHaveLength(1);
  });
});
