import { describe, expect, it } from 'vitest';

import type { TaskEntry } from '../src/lib/domain';
import { computeSegments, linearScale, timeDomain, topoOrder } from '../src/lib/tasks-timeline';

const ms = (iso: string) => Date.parse(iso);
const NOW = ms('2026-07-03T12:00:00.000Z');

function task(over: Partial<TaskEntry> & Pick<TaskEntry, 'id' | 'createdAt' | 'at' | 'status'>): TaskEntry {
  return {
    member: 'a@b.c', title: over.id, priority: 'medium', ownerType: 'agent',
    ...over,
  } as TaskEntry;
}

describe('computeSegments', () => {
  it('started + done: wait then work, no milestone', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      startedAt: '2026-07-03T02:00:00.000Z', at: '2026-07-03T05:00:00.000Z', status: 'done' });
    expect(computeSegments(t, NOW)).toEqual({
      waitStart: ms('2026-07-03T00:00:00.000Z'), waitEnd: ms('2026-07-03T02:00:00.000Z'),
      workStart: ms('2026-07-03T02:00:00.000Z'), workEnd: ms('2026-07-03T05:00:00.000Z'),
      milestone: false, arrowAnchor: ms('2026-07-03T02:00:00.000Z'),
    });
  });

  it('started + still running: work runs to now', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      startedAt: '2026-07-03T02:00:00.000Z', at: '2026-07-03T02:00:00.000Z', status: 'in_progress' });
    const s = computeSegments(t, NOW);
    expect(s.workStart).toBe(ms('2026-07-03T02:00:00.000Z'));
    expect(s.workEnd).toBe(NOW);
    expect(s.milestone).toBe(false);
  });

  it('never started + terminal: wait-only, milestone at end', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T03:00:00.000Z', status: 'done' });
    const s = computeSegments(t, NOW);
    expect(s.waitEnd).toBe(ms('2026-07-03T03:00:00.000Z'));
    expect(s.workStart).toBeUndefined();
    expect(s.milestone).toBe(true);
    expect(s.arrowAnchor).toBe(ms('2026-07-03T00:00:00.000Z')); // createdAt
  });

  it('never started + open (todo): wait runs to now, no milestone', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T00:00:00.000Z', status: 'todo' });
    const s = computeSegments(t, NOW);
    expect(s.waitEnd).toBe(NOW);
    expect(s.milestone).toBe(false);
  });
});

describe('timeDomain', () => {
  it('spans min(createdAt) to max(end/now), min-width guarded', () => {
    const tasks = [
      task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T01:00:00.000Z', status: 'done' }),
      task({ id: 'b', createdAt: '2026-07-03T04:00:00.000Z', at: '2026-07-03T04:00:00.000Z', status: 'todo' }),
    ];
    const [lo, hi] = timeDomain(tasks, NOW);
    expect(lo).toBe(ms('2026-07-03T00:00:00.000Z'));
    expect(hi).toBe(NOW); // task b is open -> now is the max
  });

  it('all-same-instant gets a non-zero width', () => {
    const tasks = [task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T00:00:00.000Z', status: 'done' })];
    const [lo, hi] = timeDomain(tasks, ms('2026-07-03T00:00:00.000Z'));
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('topoOrder', () => {
  it('places predecessors before successors, ties by createdAt', () => {
    const a = task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'done' });
    const b = task({ id: 'b', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['a'] });
    expect(topoOrder([b, a]).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('is cycle-safe (no infinite loop, all nodes returned)', () => {
    const a = task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['b'] });
    const b = task({ id: 'b', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['a'] });
    expect(topoOrder([a, b]).map((t) => t.id).sort()).toEqual(['a', 'b']);
  });
});

describe('linearScale', () => {
  it('maps domain endpoints to range endpoints', () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });
});
