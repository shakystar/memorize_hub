/**
 * ndjson-on-disk store-and-forward log: one append-only file per project at
 * `<root>/<projectId>/events.ndjson` (the same layout memorize's file
 * transport uses). The file is the only durable state — on open, each
 * project's dedup index (seen-id Set) is rebuilt by scanning its ndjson.
 *
 * Invariants (PROTOCOL.md): append-only, order-preserving, idempotent
 * dedup-by-id, opaque payloads.
 */
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { OpaqueEvent } from './protocol.js';

/** Per-store size counters — opaque (no payload inspection): count + on-disk bytes. */
export interface StoreStat {
  storeId: string;
  events: number;
  bytes: number;
}

/** Relay-wide usage snapshot for the gateway's cost dashboard (sizes only). */
export interface RelayStats {
  stores: StoreStat[];
  totals: { stores: number; events: number; bytes: number };
}

interface ProjectLog {
  events: OpaqueEvent[];
  seen: Set<string>;
  /** Resolves once the ndjson on disk has been hydrated into memory. */
  ready: Promise<void>;
  /**
   * Per-project append serialization: each append chains on this tail so
   * concurrent pushes can't interleave ndjson lines (AGENTS.md concurrency).
   */
  tail: Promise<unknown>;
}

export class EventStore {
  private readonly projects = new Map<string, ProjectLog>();

  private constructor(private readonly rootDir: string) {}

  /** Open the store, rebuilding every existing project's dedup index. */
  static async open(rootDir: string): Promise<EventStore> {
    const store = new EventStore(rootDir);
    await mkdir(rootDir, { recursive: true });
    const entries = await readdir(rootDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => store.ensure(entry.name).ready),
    );
    return store;
  }

  private eventsFile(projectId: string): string {
    return join(this.rootDir, projectId, 'events.ndjson');
  }

  private ensure(projectId: string): ProjectLog {
    let log = this.projects.get(projectId);
    if (!log) {
      const fresh: ProjectLog = {
        events: [],
        seen: new Set(),
        ready: Promise.resolve(),
        tail: Promise.resolve(),
      };
      fresh.ready = this.hydrate(projectId, fresh);
      fresh.tail = fresh.ready;
      this.projects.set(projectId, fresh);
      log = fresh;
    }
    return log;
  }

  private async hydrate(projectId: string, log: ProjectLog): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.eventsFile(projectId), 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let event: OpaqueEvent;
      try {
        event = JSON.parse(line) as OpaqueEvent;
      } catch {
        // Tolerate a torn final line from an interrupted append; never let a
        // bad line block the rest of the log.
        console.warn(`[store] skipping malformed ndjson line in ${projectId}`);
        continue;
      }
      if (typeof event.id !== 'string' || log.seen.has(event.id)) continue;
      log.seen.add(event.id);
      log.events.push(event);
    }
  }

  /**
   * Append events in array order, skipping ids already stored (idempotent
   * dedup). Returns the ids newly stored by this call. In-memory state is
   * updated only after the disk write succeeds, so memory never claims more
   * than the file holds.
   */
  async append(projectId: string, events: OpaqueEvent[]): Promise<string[]> {
    const log = this.ensure(projectId);
    const run = log.tail.then(async () => {
      const fresh: OpaqueEvent[] = [];
      const batchIds = new Set<string>();
      for (const event of events) {
        if (log.seen.has(event.id) || batchIds.has(event.id)) continue;
        batchIds.add(event.id);
        fresh.push(event);
      }
      if (fresh.length === 0) return [];
      const lines = fresh.map((event) => JSON.stringify(event) + '\n').join('');
      await mkdir(join(this.rootDir, projectId), { recursive: true });
      await appendFile(this.eventsFile(projectId), lines, 'utf8');
      for (const event of fresh) {
        log.seen.add(event.id);
        log.events.push(event);
      }
      return fresh.map((event) => event.id);
    });
    // Keep the chain alive even if this append rejects.
    log.tail = run.catch(() => undefined);
    return run;
  }

  /**
   * Per-store sizes for the gateway's cost dashboard: in-memory event count plus
   * the events.ndjson on-disk byte size. Opaque — reads file metadata and the
   * hydrated count only, never a payload — so relay opacity (H010) holds. Sorted
   * largest-first; a store whose file isn't written yet reports 0 bytes.
   */
  async stats(): Promise<RelayStats> {
    const stores: StoreStat[] = [];
    let totalEvents = 0;
    let totalBytes = 0;
    for (const [projectId, log] of this.projects) {
      await log.ready;
      let bytes = 0;
      try {
        bytes = (await stat(this.eventsFile(projectId))).size;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const events = log.events.length;
      stores.push({ storeId: projectId, events, bytes });
      totalEvents += events;
      totalBytes += bytes;
    }
    stores.sort((a, b) => b.bytes - a.bytes);
    return { stores, totals: { stores: stores.length, events: totalEvents, bytes: totalBytes } };
  }

  /**
   * Events stored after `sinceId`, in insertion order. No `sinceId` — or an
   * unknown one (compacted/never-stored) — returns everything: over-returning
   * is always safe (clients dedup), under-returning is not.
   */
  async read(projectId: string, sinceId?: string): Promise<OpaqueEvent[]> {
    const log = this.ensure(projectId);
    await log.ready;
    if (!sinceId) return [...log.events];
    const index = log.events.findIndex((event) => event.id === sinceId);
    return log.events.slice(index + 1);
  }
}
