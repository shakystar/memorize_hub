import { describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';
import { recordUsage, usageSince, type UsageRow } from '../../src/usage.js';

/**
 * Usage metering DAL (cost visibility). Deterministic via an injected `now`, so
 * no wall-clock dependence. Metering records sizes only — never event content —
 * and gates nothing.
 */

const day = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('usage metering', () => {
  it('accumulates requests + bytes per store per UTC day', () => {
    const db = openGatewayDb(':memory:');
    recordUsage(db, 'wsp_a', 100, 200, day('2026-07-01'));
    recordUsage(db, 'wsp_a', 10, 20, day('2026-07-01'));
    recordUsage(db, 'wsp_a', 1, 2, day('2026-07-02'));

    const rows = usageSince(db, '2026-07-01');
    const byDay = Object.fromEntries(rows.map((r: UsageRow) => [r.day, r]));
    expect(byDay['2026-07-01']).toMatchObject({
      storeId: 'wsp_a',
      requests: 2,
      bytesIn: 110,
      bytesOut: 220,
    });
    expect(byDay['2026-07-02']).toMatchObject({ requests: 1, bytesIn: 1, bytesOut: 2 });
    db.close();
  });

  it('keeps stores separate and honours the sinceDay floor', () => {
    const db = openGatewayDb(':memory:');
    recordUsage(db, 'wsp_a', 5, 5, day('2026-06-30'));
    recordUsage(db, 'wsp_b', 7, 7, day('2026-07-01'));

    const since = usageSince(db, '2026-07-01');
    expect(since.map((r) => r.storeId)).toEqual(['wsp_b']); // 06-30 excluded
    db.close();
  });
});
