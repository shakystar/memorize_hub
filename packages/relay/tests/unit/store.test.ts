import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EventStore } from '../../src/store.js';
import type { OpaqueEvent } from '../../src/protocol.js';

const evt = (id: string, extra: Record<string, unknown> = {}): OpaqueEvent => ({
  id,
  type: 'observation.captured',
  ...extra,
});

let dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hub-store-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('EventStore', () => {
  it('appends in order and dedups by id (idempotent re-push)', async () => {
    const store = await EventStore.open(await freshDir());
    expect(await store.append('proj_a', [evt('evt_1'), evt('evt_2')])).toEqual([
      'evt_1',
      'evt_2',
    ]);
    // Overlapping re-push: only the new id is accepted.
    expect(await store.append('proj_a', [evt('evt_2'), evt('evt_3')])).toEqual([
      'evt_3',
    ]);
    // Duplicate ids within one batch: first wins.
    expect(await store.append('proj_a', [evt('evt_4'), evt('evt_4')])).toEqual([
      'evt_4',
    ]);
    const ids = (await store.read('proj_a')).map((event) => event.id);
    expect(ids).toEqual(['evt_1', 'evt_2', 'evt_3', 'evt_4']);
  });

  it('read honors since semantics: found, missing, absent', async () => {
    const store = await EventStore.open(await freshDir());
    await store.append('proj_a', [evt('evt_1'), evt('evt_2'), evt('evt_3')]);

    expect((await store.read('proj_a', 'evt_1')).map((event) => event.id)).toEqual([
      'evt_2',
      'evt_3',
    ]);
    expect(await store.read('proj_a', 'evt_3')).toEqual([]);
    // Unknown since id -> all events (over-returning is safe, clients dedup).
    expect((await store.read('proj_a', 'evt_unknown')).map((event) => event.id)).toEqual([
      'evt_1',
      'evt_2',
      'evt_3',
    ]);
    expect((await store.read('proj_a')).map((event) => event.id)).toEqual([
      'evt_1',
      'evt_2',
      'evt_3',
    ]);
  });

  it('isolates projects from each other', async () => {
    const store = await EventStore.open(await freshDir());
    await store.append('proj_a', [evt('evt_1')]);
    await store.append('proj_b', [evt('evt_1'), evt('evt_2')]);
    expect((await store.read('proj_a')).map((event) => event.id)).toEqual(['evt_1']);
    expect((await store.read('proj_b')).map((event) => event.id)).toEqual([
      'evt_1',
      'evt_2',
    ]);
  });

  it('persists as ndjson and rebuilds the dedup index on reopen', async () => {
    const dir = await freshDir();
    const first = await EventStore.open(dir);
    await first.append('proj_a', [evt('evt_1', { payload: 'x' }), evt('evt_2')]);

    const raw = await readFile(join(dir, 'proj_a', 'events.ndjson'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 'evt_1', payload: 'x' });

    // The file is the only durable state: a new store instance over the same
    // dir must see the events AND still dedup against them.
    const second = await EventStore.open(dir);
    expect((await second.read('proj_a')).map((event) => event.id)).toEqual([
      'evt_1',
      'evt_2',
    ]);
    expect(await second.append('proj_a', [evt('evt_2'), evt('evt_3')])).toEqual([
      'evt_3',
    ]);
  });

  it('tolerates a torn final ndjson line on hydrate', async () => {
    const dir = await freshDir();
    await mkdir(join(dir, 'proj_a'), { recursive: true });
    await writeFile(
      join(dir, 'proj_a', 'events.ndjson'),
      `${JSON.stringify(evt('evt_1'))}\n{"id":"evt_2","trunc`,
      'utf8',
    );
    const store = await EventStore.open(dir);
    expect((await store.read('proj_a')).map((event) => event.id)).toEqual(['evt_1']);
    // The torn id was never indexed, so a re-push of it must be accepted.
    expect(await store.append('proj_a', [evt('evt_2')])).toEqual(['evt_2']);
  });

  it('serializes concurrent appends per project without interleaving lines', async () => {
    const dir = await freshDir();
    const store = await EventStore.open(dir);
    const batches = Array.from({ length: 20 }, (_, batch) =>
      Array.from({ length: 10 }, (_, n) => evt(`evt_${batch}_${n}`)),
    );
    await Promise.all(batches.map((batch) => store.append('proj_a', batch)));

    const raw = await readFile(join(dir, 'proj_a', 'events.ndjson'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(200);
    // Every line parses cleanly and batch-internal order is preserved.
    const ids = lines.map((line) => (JSON.parse(line) as OpaqueEvent).id);
    expect(new Set(ids).size).toBe(200);
    for (const batch of batches) {
      const positions = batch.map((event) => ids.indexOf(event.id));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
    // In-memory order matches the file (pull returns insertion order).
    expect((await store.read('proj_a')).map((event) => event.id)).toEqual(ids);
  });
});
