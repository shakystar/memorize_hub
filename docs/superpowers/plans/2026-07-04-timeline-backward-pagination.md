# Timeline Backward Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workspace timeline page backward through older memories via a stable cursor, so scrolling to the top loads history instead of dead-ending at the newest window.

**Architecture:** A `(at, id)` strict-less-than cursor windows the replica projection (in-memory, memorize core untouched); the gateway forwards the `before` param and preserves the new `nextCursor`/`hasMore` fields; a dedicated web hook accumulates older pages by prepend + id-dedup; TimelineTab loads older pages from a top sentinel with scroll-anchor preservation.

**Tech Stack:** TypeScript, `node:http` (replica + gateway servers), better-sqlite3 (gateway), React 18 (web/Vite), vitest.

**Spec:** `docs/superpowers/specs/2026-07-04-timeline-backward-pagination-design.md`

## Global Constraints

- **All commands run from the worktree root** `C:/dev/active/memorize_hub-timeline` (branch `fix/timeline-backward-pagination`). The shell resets cwd between calls — prefix each command with `cd C:/dev/active/memorize_hub-timeline &&` or run via subagent with that cwd.
- **relay package is never touched.** Windowing is in-memory over the already-loaded projection; memorize core (`@shakystar/memorize/dist/...`) is consumed read-only.
- **Cursor is opaque on the wire:** `base64url(`${at}|${id}`)`. Only the replica encodes/decodes; gateway and web treat it as an opaque string and never parse it.
- **Default page size = 50** (`PAGE_SIZE`/`DEFAULT_LIMIT`), one value per layer, kept identical.
- **Cursor ordering must match the existing `byAscendingTimeline`:** string compare on `at`, tie-break string compare on `id`.
- **Commit after every task.** Conventional-commit messages, footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Package names: replica `@shakystar/memorize-hub-replica`, gateway `@shakystar/memorize-hub-gateway`, web `@shakystar/memorize-hub-web`.

---

## File Structure

- **Modify** `packages/replica/src/timeline.ts` — cursor codec, `(at,id)` windowing, `nextCursor`/`hasMore` in the result, `before` param, default limit 50.
- **Modify** `packages/replica/src/server.ts` — parse `before` query → cursor, 400 on malformed, pass through.
- **Modify** `packages/gateway/src/timeline.ts` — forward `before` to the replica.
- **Modify** `packages/web/src/lib/api.ts` — `getWorkspaceTimeline(id, { limit?, before? })`, response gains `nextCursor?`/`hasMore`.
- **Create** `packages/web/src/lib/timeline-page.ts` — pure `compareItems` + `mergeOlderPage` (unit-tested).
- **Create** `packages/web/src/lib/paginated-timeline.ts` — the `usePaginatedTimeline` React hook.
- **Modify** `packages/web/src/components/canvas/WorkspaceCanvas.tsx` — use the hook, hand its scroll container's ref to TimelineTab.
- **Modify** `packages/web/src/components/canvas/TimelineTab.tsx` — top sentinel + IntersectionObserver, scroll-anchor preservation, bottom-scroll-only-on-tail fix, new props.
- **Extend** `packages/replica/tests/unit/timeline.test.ts`, `packages/gateway/tests/unit/timeline.test.ts`.
- **Create** `packages/web/tests/unit/timeline-page.test.ts` + web vitest infra.

---

## Task 1: Replica cursor codec + `(at,id)` windowing

**Files:**
- Modify: `packages/replica/src/timeline.ts`
- Test: `packages/replica/tests/unit/timeline.test.ts`

**Interfaces:**
- Consumes: existing `readTimeline`, `TimelineMemoryItem`, `byAscendingTimeline`.
- Produces:
  - `interface TimelineCursor { at: string; id: string }`
  - `encodeCursor(at: string, id: string): string` (base64url)
  - `decodeCursor(raw: string): TimelineCursor` (throws on malformed)
  - `ReadTimelineParams` gains `before?: TimelineCursor`
  - `ReadTimelineResult` gains `hasMore: boolean` and `nextCursor?: string`
  - default limit 50 when `params.limit` omitted

- [ ] **Step 1: Write the failing tests**

Append to `packages/replica/tests/unit/timeline.test.ts`. First add a helper that seeds many memories, then the cases. Put this inside the file (after the existing imports add `encodeCursor, decodeCursor` to the `readTimeline` import):

```ts
// at top: extend the existing import
import { decodeCursor, encodeCursor, readTimeline } from '../../src/timeline.js';

// helper: N memory.consolidated events, 1 minute apart, ascending
function manyMemoryEvents(storeId: string, n: number): DomainEvent[] {
  const base = Date.parse('2026-07-03T00:00:00.000Z');
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(base + i * 60_000).toISOString();
    return {
      id: `evt_mem_${String(i).padStart(3, '0')}`,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: at,
      updatedAt: at,
      type: 'memory.consolidated',
      projectId: storeId,
      scopeType: 'project',
      scopeId: storeId,
      actor: 'user',
      writer: ACC,
      sourceProjectId: storeId,
      payload: {
        id: `mem_${String(i).padStart(3, '0')}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: at,
        updatedAt: at,
        projectId: storeId,
        kind: 'progress',
        text: `memory ${i}`,
        salience: 5,
        sourceObservationIds: [],
        tags: [],
        importSource: 'hub-web',
      },
    } satisfies DomainEvent;
  });
}

describe('readTimeline cursor windowing', () => {
  it('round-trips a cursor and rejects a malformed one', () => {
    const c = encodeCursor('2026-07-03T00:05:00.000Z', 'mem_005');
    expect(decodeCursor(c)).toEqual({ at: '2026-07-03T00:05:00.000Z', id: 'mem_005' });
    expect(() => decodeCursor('bm9waXBl')).toThrow(/cursor/); // base64url "nopipe", no '|'
  });

  it('returns the newest page with hasMore + nextCursor at the page floor', async () => {
    const storeId = serverStoreId(WSP);
    const res = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      limit: 3,
      fetchImpl: fakeHub(manyMemoryEvents(storeId, 10), []),
    });
    expect(res.items.map((i) => i.id)).toEqual(['mem_007', 'mem_008', 'mem_009']);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe(encodeCursor('2026-07-03T00:07:00.000Z', 'mem_007'));
  });

  it('pages strictly older than the cursor with no overlap', async () => {
    const storeId = serverStoreId(WSP);
    const res = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      limit: 3,
      before: { at: '2026-07-03T00:07:00.000Z', id: 'mem_007' },
      fetchImpl: fakeHub(manyMemoryEvents(storeId, 10), []),
    });
    expect(res.items.map((i) => i.id)).toEqual(['mem_004', 'mem_005', 'mem_006']);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe(encodeCursor('2026-07-03T00:04:00.000Z', 'mem_004'));
  });

  it('marks the last (oldest) page hasMore=false and omits nextCursor', async () => {
    const storeId = serverStoreId(WSP);
    const res = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      limit: 3,
      before: { at: '2026-07-03T00:02:00.000Z', id: 'mem_002' },
      fetchImpl: fakeHub(manyMemoryEvents(storeId, 10), []),
    });
    expect(res.items.map((i) => i.id)).toEqual(['mem_000', 'mem_001']);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-replica test -- timeline`
Expected: FAIL — `encodeCursor`/`decodeCursor` are not exported; `res.hasMore`/`res.nextCursor` undefined; windowing returns the wrong ids.

- [ ] **Step 3: Implement the codec + windowing**

In `packages/replica/src/timeline.ts`:

Add near the top (after imports):

```ts
const DEFAULT_LIMIT = 50;

export interface TimelineCursor {
  at: string;
  id: string;
}

/** Opaque wire cursor. Only the replica encodes/decodes it. */
export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): TimelineCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep <= 0 || sep === decoded.length - 1) {
    throw new Error(`malformed timeline cursor: ${raw}`);
  }
  return { at: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

/** Strict (at,id) < cursor, matching byAscendingTimeline ordering. */
function isBeforeCursor(item: { at: string; id: string }, cursor: TimelineCursor): boolean {
  if (item.at !== cursor.at) return item.at < cursor.at;
  return item.id < cursor.id;
}
```

Add `before?: TimelineCursor;` to `ReadTimelineParams` (below `limit?`), and extend `ReadTimelineResult`:

```ts
export interface ReadTimelineResult {
  storeId: string;
  pulled: SyncPullResult;
  items: TimelineMemoryItem[];
  /** True when older items exist beyond this page. */
  hasMore: boolean;
  /** Opaque cursor for the next older page; omitted when hasMore is false. */
  nextCursor?: string;
}
```

Replace the final projection/return block (currently `const items = listValidMemories(...).map(...).sort(byAscendingTimeline);` through the `return { storeId, pulled, items: params.limit ? items.slice(-params.limit) : items }`) with:

```ts
  const all = listValidMemories(storeId, 'union')
    .map(({ memory }) => {
      const event = memoryEvents.get(memory.id);
      const writer = event?.writer;
      const sourceProjectId = memory.sourceProjectId ?? event?.sourceProjectId;
      return {
        id: memory.id,
        at: memory.createdAt,
        type: 'memory.consolidated' as const,
        kind: memory.kind,
        text: memory.text,
        salience: memory.salience,
        member: writer ?? sourceProjectId ?? storeId,
        ...(writer ? { writer } : {}),
        ...(sourceProjectId ? { sourceProjectId, sourceProjectLabel: sourceProjectId } : {}),
        ...(memory.tags?.length ? { tags: memory.tags } : {}),
      };
    })
    .sort(byAscendingTimeline);

  const limit = params.limit ?? DEFAULT_LIMIT;
  const pool = params.before ? all.filter((i) => isBeforeCursor(i, params.before!)) : all;
  const page = pool.slice(-limit);
  const hasMore = pool.length > page.length;
  const oldest = page[0];

  return {
    storeId,
    pulled,
    items: page,
    hasMore,
    ...(hasMore && oldest ? { nextCursor: encodeCursor(oldest.at, oldest.id) } : {}),
  };
```

(The `.map(...)` body is unchanged from the current code — only the variable name `items`→`all` and the windowing/return differ. Keep the existing `limit` validation block above intact.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-replica test -- timeline`
Expected: PASS, including the pre-existing `readTimeline` cases (1-memory fixtures still return `hasMore:false`, no `nextCursor`).

- [ ] **Step 5: Typecheck + commit**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-replica typecheck`
Expected: clean.

```bash
cd C:/dev/active/memorize_hub-timeline
git add packages/replica/src/timeline.ts packages/replica/tests/unit/timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(replica): (at,id) cursor windowing for the timeline projection

readTimeline now returns a page + hasMore + opaque nextCursor and accepts a
before cursor; default page size 50. In-memory over the union projection,
memorize core untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `before` through the replica server + gateway

**Files:**
- Modify: `packages/replica/src/server.ts`
- Modify: `packages/gateway/src/timeline.ts`
- Test: `packages/gateway/tests/unit/timeline.test.ts`

**Interfaces:**
- Consumes: `decodeCursor`, `TimelineCursor` from Task 1; `readTimeline` `before` param.
- Produces: replica `GET /timeline?before=<cursor>` returns a 400 on a malformed cursor and otherwise windows; gateway forwards `before` and preserves `nextCursor`/`hasMore` through `labelMembers`.

- [ ] **Step 1: Write the failing gateway test**

The mock replica in `packages/gateway/tests/unit/timeline.test.ts` must first advertise the new fields. In the timeline branch of the mock (the `res.end(JSON.stringify({ storeId: 'proj_hub_timeline', pulled: ..., items: [...] }))` call), add `hasMore: true` and `nextCursor: 'CURSOR_ABC'` as top-level siblings of `items`. Then append this test inside `describe('workspace timeline endpoint', ...)`:

```ts
it('forwards the before cursor and preserves hasMore/nextCursor through labeling', async () => {
  const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline?limit=2&before=CURSOR_ABC`, {
    headers: auth(aliceKey),
  });
  expect(res.status).toBe(200);
  expect(replicaRequests.at(-1)).toContain('before=CURSOR_ABC');
  expect(replicaRequests.at(-1)).toContain('limit=2');
  const body = (await res.json()) as { hasMore: boolean; nextCursor?: string };
  expect(body.hasMore).toBe(true);
  expect(body.nextCursor).toBe('CURSOR_ABC');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-gateway test -- timeline`
Expected: FAIL — `replicaRequests.at(-1)` has no `before=` (gateway drops it).

- [ ] **Step 3: Forward `before` in the gateway**

In `packages/gateway/src/timeline.ts`, inside `handleWorkspaceTimeline`, after the existing `limit` block:

```ts
  const limit = query.get('limit');
  if (limit !== null) params.set('limit', limit);
  const before = query.get('before');
  if (before !== null) params.set('before', before);
  return forwardReplicaRead(req, res, ctx, storeId, 'timeline', params);
```

(`labelMembers` already rebuilds the body as `{ ...body, items }`, so `hasMore`/`nextCursor` pass through unchanged — no edit needed there.)

- [ ] **Step 4: Run the gateway test to verify it passes**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-gateway test -- timeline`
Expected: PASS.

- [ ] **Step 5: Parse `before` in the replica server (mirror the limit guard)**

In `packages/replica/src/server.ts`, extend the import:

```ts
import { decodeCursor, readTimeline, type TimelineCursor } from './timeline.js';
```

Inside the timeline route branch, after the existing `limit` validation and before the `readTimeline(...)` call:

```ts
        const rawBefore = url.searchParams.get('before');
        let before: TimelineCursor | undefined;
        if (rawBefore !== null) {
          try {
            before = decodeCursor(rawBefore);
          } catch {
            sendJson(res, 400, { error: 'before must be a valid cursor' });
            return;
          }
        }
        const result = await readTimeline({
          hubUrl: options.relayUrl,
          apiKey: options.relayToken ?? '',
          workspaceId: decodeURIComponent(timeline[1] ?? ''),
          ...(limit !== undefined ? { limit } : {}),
          ...(before ? { before } : {}),
        });
```

- [ ] **Step 6: Typecheck both packages + commit**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-replica --filter @shakystar/memorize-hub-gateway typecheck`
Expected: clean.

```bash
cd C:/dev/active/memorize_hub-timeline
git add packages/replica/src/server.ts packages/gateway/src/timeline.ts packages/gateway/tests/unit/timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway,replica): pass the timeline before cursor through both HTTP layers

Gateway forwards ?before= and preserves hasMore/nextCursor through member
labeling; replica server decodes the cursor and 400s a malformed one.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Web API signature + pure page-merge helpers + vitest infra

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/timeline-page.ts`
- Create: `packages/web/tests/unit/timeline-page.test.ts`
- Modify: `packages/web/package.json` (add vitest + test script)
- Create: `packages/web/vitest.config.ts`

**Interfaces:**
- Consumes: `TimelineItem` from `./domain`.
- Produces:
  - `getWorkspaceTimeline(id: string, query?: { limit?: number; before?: string }): Promise<TimelineResponse>`
  - `TimelineResponse` gains `nextCursor?: string; hasMore: boolean`
  - `compareItems(a: TimelineItem, b: TimelineItem): number`
  - `mergeOlderPage(existing: TimelineItem[], older: TimelineItem[]): TimelineItem[]`

- [ ] **Step 1: Add vitest to the web package**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-web add -D vitest`

Create `packages/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

In `packages/web/package.json`, set the test script and fold it into `check`:

```jsonc
"test": "vitest run",
"check": "pnpm typecheck && pnpm lint && pnpm test",
```

- [ ] **Step 2: Write the failing helper tests**

Create `packages/web/tests/unit/timeline-page.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-web test`
Expected: FAIL — `../../src/lib/timeline-page` does not exist.

- [ ] **Step 4: Implement the pure helpers**

Create `packages/web/src/lib/timeline-page.ts`:

```ts
import type { TimelineItem } from './domain';

/** (at, id) ascending — identical ordering to the replica's byAscendingTimeline. */
export function compareItems(a: TimelineItem, b: TimelineItem): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge an older page beneath the loaded items: union by id (existing wins on a
 * duplicate — the newest projection of a memory), re-sorted ascending. Order-
 * independent so a late newest-refresh cannot corrupt the accumulated history.
 */
export function mergeOlderPage(existing: TimelineItem[], older: TimelineItem[]): TimelineItem[] {
  const byId = new Map<string, TimelineItem>();
  for (const it of older) byId.set(it.id, it);
  for (const it of existing) byId.set(it.id, it);
  return [...byId.values()].sort(compareItems);
}
```

- [ ] **Step 5: Update `getWorkspaceTimeline`**

In `packages/web/src/lib/api.ts`, replace the `TimelineResponse` interface and `getWorkspaceTimeline`:

```ts
export interface TimelineResponse {
  storeId: string;
  pulled: { total: number; inserted: number; lastRemoteEventId?: string };
  items: TimelineItem[];
  /** True when older items exist beyond this page. */
  hasMore: boolean;
  /** Opaque cursor for the next older page; absent on the oldest page. */
  nextCursor?: string;
}

/** Live workspace timeline (one page). Demo/mock views do not call this. */
export async function getWorkspaceTimeline(
  id: string,
  query: { limit?: number; before?: string } = {},
): Promise<TimelineResponse> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
  if (query.before) params.set('before', query.before);
  const res = await fetch(`/v1/workspaces/${q(id)}/timeline?${params.toString()}`, {
    credentials: 'same-origin',
  });
  await ok(res, `GET /v1/workspaces/${id}/timeline`);
  return (await res.json()) as TimelineResponse;
}
```

- [ ] **Step 6: Run tests + typecheck to verify pass**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-web test && pnpm --filter @shakystar/memorize-hub-web typecheck`
Expected: helper tests PASS. Typecheck may report the old `getWorkspaceTimeline(id, limit)` call site in `WorkspaceCanvas.tsx` — that is rewired in Task 5; if typecheck fails only there, proceed (Task 5 fixes it). Confirm no other errors.

- [ ] **Step 7: Commit**

```bash
cd C:/dev/active/memorize_hub-timeline
git add packages/web/src/lib/timeline-page.ts packages/web/tests/unit/timeline-page.test.ts packages/web/src/lib/api.ts packages/web/vitest.config.ts packages/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): paged timeline API + pure page-merge helpers (+ vitest)

getWorkspaceTimeline takes { limit, before } and returns hasMore/nextCursor;
compareItems/mergeOlderPage are order-independent (union by id). Adds vitest
to the web package for the pure logic.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `usePaginatedTimeline` hook

**Files:**
- Create: `packages/web/src/lib/paginated-timeline.ts`

**Interfaces:**
- Consumes: `getWorkspaceTimeline` (Task 3), `mergeOlderPage` (Task 3), `TimelineItem`.
- Produces: `usePaginatedTimeline(workspaceId: string, enabled: boolean): PaginatedTimeline` where
  `PaginatedTimeline = { items: TimelineItem[]; loading: boolean; error?: string; hasMore: boolean; loadingOlder: boolean; loadOlder: () => void }`.

> No unit test: this is browser/React state exercised end-to-end in Task 6 `/verify`. Its pure dependency (`mergeOlderPage`) is unit-tested in Task 3. The gate here is typecheck.

- [ ] **Step 1: Implement the hook**

Create `packages/web/src/lib/paginated-timeline.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { getWorkspaceTimeline } from './api';
import type { TimelineItem } from './domain';
import { mergeOlderPage } from './timeline-page';

const PAGE_SIZE = 50;

export interface PaginatedTimeline {
  items: TimelineItem[];
  /** Fetching the first page with an empty cache — the only spinner state. */
  loading: boolean;
  error?: string;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

/**
 * Backward-paginating timeline feed. Mirrors useLiveFeed's stale-while-
 * revalidate cache for the NEWEST page (instant paint on reload), then
 * accumulates older pages by prepend on loadOlder(). One fetch per mount (no
 * polling), so there is no newest-refresh vs older-page race within a session.
 */
export function usePaginatedTimeline(workspaceId: string, enabled: boolean): PaginatedTimeline {
  const key = `hub:timeline:${workspaceId}`;
  const [items, setItems] = useState<TimelineItem[]>(() => (enabled ? readCache(key) ?? [] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const activeKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    activeKey.current = key;
    const cached = readCache(key);
    setItems(cached ?? []);
    setLoading(!cached);
    setError(undefined);
    setLoadingOlder(false);
    cursorRef.current = undefined;
    getWorkspaceTimeline(workspaceId, { limit: PAGE_SIZE })
      .then((res) => {
        if (activeKey.current !== key) return; // workspace moved on
        writeCache(key, res.items);
        setItems(res.items);
        setHasMore(res.hasMore);
        cursorRef.current = res.nextCursor;
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (activeKey.current !== key) return;
        setLoading(false);
        if (!cached) setError(e instanceof Error ? e.message : String(e));
      });
  }, [enabled, key, workspaceId]);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    setLoadingOlder(true);
    getWorkspaceTimeline(workspaceId, { limit: PAGE_SIZE, before: cursor })
      .then((res) => {
        if (activeKey.current !== key) return;
        setItems((prev) => mergeOlderPage(prev, res.items));
        setHasMore(res.hasMore);
        cursorRef.current = res.nextCursor;
        setLoadingOlder(false);
      })
      .catch(() => {
        if (activeKey.current !== key) return;
        setLoadingOlder(false); // keep what we have; scrolling retriggers
      });
  }, [hasMore, loadingOlder, workspaceId, key]);

  return { items, loading, error, hasMore, loadingOlder, loadOlder };
}

const memoryCache = new Map<string, TimelineItem[]>();

function readCache(key: string): TimelineItem[] | undefined {
  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TimelineItem[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, items: TimelineItem[]): void {
  memoryCache.set(key, items);
  try {
    sessionStorage.setItem(key, JSON.stringify(items));
  } catch {
    // quota / private mode: in-memory copy still covers this tab
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-web typecheck`
Expected: no new errors from this file (the WorkspaceCanvas call site is still Task 5's).

- [ ] **Step 3: Commit**

```bash
cd C:/dev/active/memorize_hub-timeline
git add packages/web/src/lib/paginated-timeline.ts
git commit -m "$(cat <<'EOF'
feat(web): usePaginatedTimeline hook — cached newest page + prepend older

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TimelineTab scroll integration + WorkspaceCanvas wiring

**Files:**
- Modify: `packages/web/src/components/canvas/TimelineTab.tsx`
- Modify: `packages/web/src/components/canvas/WorkspaceCanvas.tsx`

**Interfaces:**
- Consumes: `usePaginatedTimeline` (Task 4).
- Produces: TimelineTab props gain
  `hasMore: boolean; loadingOlder: boolean; onLoadOlder: () => void; scrollParentRef: RefObject<HTMLDivElement>`.

> Gate: typecheck + lint here; behavior is confirmed in Task 6 `/verify`.

- [ ] **Step 1: Extend TimelineTab props + top sentinel + older-load affordance**

In `packages/web/src/components/canvas/TimelineTab.tsx`:

Update the import line to include the hooks/types used:

```ts
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
```

Change the component signature and destructure:

```ts
export function TimelineTab({
  items,
  meEmail,
  badge,
  emptyState,
  hasMore,
  loadingOlder,
  onLoadOlder,
  scrollParentRef,
}: {
  items: TimelineItem[];
  meEmail: string;
  badge?: string;
  emptyState: ReactNode;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  scrollParentRef: RefObject<HTMLDivElement>;
}) {
```

Replace the existing bottom-scroll effect (`const bottomRef = useRef... useEffect(() => { bottomRef.current?.scrollIntoView... }, [visible.length]);`) with the refs + three effects below. Keep `bottomRef`.

```ts
  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const lastNewestId = useRef<string | undefined>(undefined);
  const anchorHeight = useRef<number | null>(null);

  // Bottom-anchor ONLY on first paint and when a new newest-tail arrives — never
  // on an older-page prepend (which changes the oldest item, not the newest).
  useEffect(() => {
    if (visible.length === 0) return;
    const newestId = visible[visible.length - 1]?.id;
    if (!didInitialScroll.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      didInitialScroll.current = true;
      lastNewestId.current = newestId;
      return;
    }
    if (newestId !== lastNewestId.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      lastNewestId.current = newestId;
    }
  }, [visible]);

  // Preserve the viewport anchor across an older-page prepend: restore the
  // scroll delta the new content pushed down.
  useLayoutEffect(() => {
    const parent = scrollParentRef.current;
    if (parent && anchorHeight.current !== null) {
      parent.scrollTop += parent.scrollHeight - anchorHeight.current;
      anchorHeight.current = null;
    }
  }, [visible, scrollParentRef]);

  // Load older when the top sentinel nears the viewport top.
  useEffect(() => {
    const parent = scrollParentRef.current;
    const sentinel = topRef.current;
    if (!parent || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingOlder) {
          anchorHeight.current = parent.scrollHeight; // capture BEFORE prepend
          onLoadOlder();
        }
      },
      { root: parent, rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollParentRef, hasMore, loadingOlder, onLoadOlder]);
```

Render the sentinel + a loading strip at the very top of the scroll content, immediately after the sticky filter `<div>...</div>` and before the `{days.map(...)}`:

```tsx
      <div ref={topRef} />
      {loadingOlder && (
        <p className="py-2 text-center text-xs text-muted-foreground">Loading older…</p>
      )}
```

(The existing `<div ref={bottomRef} />` stays as the last child.)

- [ ] **Step 2: Wire the hook + scroll ref in WorkspaceCanvas**

In `packages/web/src/components/canvas/WorkspaceCanvas.tsx`:

Update imports:

```ts
import { type ReactNode, useRef, useState } from 'react';
import { usePaginatedTimeline } from '@/lib/paginated-timeline';
```

Remove the timeline `useLiveFeed` line and keep tasks on `useLiveFeed`. Replace the timeline feed with the hook, and add a scroll-container ref:

```ts
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeline = usePaginatedTimeline(workspaceId, !example);
  const tasks = useLiveFeed<TaskEntry>(`hub:tasks:${workspaceId}`, !example, () =>
    getWorkspaceTasks(workspaceId).then((result) => result.items),
  );
```

(Keep the `getWorkspaceTimeline` import only if still used elsewhere; it is now used inside the hook, so remove it from this file's imports to satisfy lint.)

Attach the ref to the existing scroll container:

```tsx
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
```

Pass the new props to `<TimelineTab>` (the `items`/`emptyState` wiring is unchanged; add the four new props):

```tsx
        {tab === 'timeline' && (
          <TimelineTab
            items={example ? MOCK_TIMELINE : timeline.items}
            meEmail={meEmail}
            badge={badge}
            hasMore={example ? false : timeline.hasMore}
            loadingOlder={example ? false : timeline.loadingOlder}
            onLoadOlder={timeline.loadOlder}
            scrollParentRef={scrollRef}
            emptyState={
              !example && timeline.loading ? (
                <TimelineStatus title="Loading timeline" />
              ) : !example && timeline.error ? (
                <TimelineStatus title="Timeline unavailable" detail={timeline.error} />
              ) : (
                <TimelineEmptyState onConnect={() => setTab('connect')} />
              )
            }
          />
        )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm --filter @shakystar/memorize-hub-web check`
Expected: typecheck + lint + helper tests all clean. Fix any unused-import / type errors surfaced here.

- [ ] **Step 4: Commit**

```bash
cd C:/dev/active/memorize_hub-timeline
git add packages/web/src/components/canvas/TimelineTab.tsx packages/web/src/components/canvas/WorkspaceCanvas.tsx
git commit -m "$(cat <<'EOF'
feat(web): timeline loads older pages on scroll-up with anchor preservation

Top sentinel + IntersectionObserver drives usePaginatedTimeline.loadOlder;
scroll anchor is restored across prepend; bottom auto-scroll now fires only
on first paint / new tail, not on older prepend.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full check, end-to-end verify, close the task

**Files:** none (validation + task bookkeeping).

- [ ] **Step 1: Monorepo check**

Run: `cd C:/dev/active/memorize_hub-timeline && pnpm -r check`
Expected: green across relay, replica, gateway, web. Investigate and fix any failure before proceeding (return to the owning task).

- [ ] **Step 2: End-to-end behavior verify**

Invoke the `/verify` skill (or the `run` skill) to drive the real app: open a workspace with **more than 50 memories**, then confirm:
- initial load lands at the newest item (bottom);
- scrolling to the top loads older pages, and the viewport stays anchored on the item you were reading (no jump-to-bottom, no jump-to-top);
- reaching the oldest memory stops loading (no infinite spinner);
- a fresh newest-tail (if one syncs) still snaps to the bottom.

If no live workspace with >50 memories is available, seed the replica fixture or temporarily lower `PAGE_SIZE` to force multi-page behavior during the check, then restore it. Record what was actually observed.

- [ ] **Step 3: Update the memorize task**

```bash
memorize task handoff --task task_mr53nnmm_sbgxornt \
  --summary "역방향 (at,id) 커서 페이지네이션 구현·검증 완료: replica 윈도잉+nextCursor/hasMore, gateway before passthrough, usePaginatedTimeline 훅, TimelineTab 상단 sentinel+앵커보존, 하단튐 잠복버그 동시 수정. pnpm -r check 그린 + >50 메모리 실구동 검증." \
  --next "PR로 fix/timeline-backward-pagination 머지. 후속: 날짜점프 캘린더(mr53no79)가 이 커서 재사용, read-lane 투영 캐싱은 그 다음."
memorize task done --task task_mr53nnmm_sbgxornt
```

- [ ] **Step 4: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to choose merge / PR / cleanup for `fix/timeline-backward-pagination`, then remove the worktree once integrated:
`git worktree remove C:/dev/active/memorize_hub-timeline` (from the main worktree, after merge).

---

## Self-Review

**Spec coverage:**
- ① Endpoint contract (cursor, `before`, `nextCursor`/`hasMore`, base64url, memorize untouched) → Tasks 1-2. ✓
- ② `usePaginatedTimeline` (dedicated hook, newest-page cache, prepend+dedup) → Tasks 3-4. ✓
- ③ Scroll (own/handed scroll container, top sentinel, anchor preservation, bottom-scroll fix, new props) → Task 5. ✓
- ④ Testing (replica cursor boundary/tie-break, gateway passthrough, web dedup, `/verify`) → Tasks 1,2,3,6. ✓
- Known cost — documented in the spec, no code; nothing to implement. ✓
- Date-jump reuse — cursor is `at`-based and exported; no build here (correctly out of scope). ✓

**Deviation from spec (intentional, noted):** §③ said "TimelineTab owns its scroll container"; the plan instead hands TimelineTab the existing WorkspaceCanvas scroll-container ref (`scrollParentRef`). Same anchor robustness, far smaller blast radius (no restructuring of the Tasks/ComingSoon tabs), lower conflict risk with parallel web work. Equivalent outcome.

**Placeholder scan:** no TBD/TODO; every code step carries full code. ✓

**Type consistency:** `TimelineCursor {at,id}`, `encodeCursor(at,id)`, `decodeCursor(raw)`, `getWorkspaceTimeline(id,{limit,before})`, `TimelineResponse.hasMore/nextCursor`, `mergeOlderPage(existing,older)`, `compareItems(a,b)`, `usePaginatedTimeline(workspaceId,enabled)` and `PaginatedTimeline` fields are used identically across Tasks 1-5. Page size is `50` in the replica (`DEFAULT_LIMIT`), api default, and hook (`PAGE_SIZE`). ✓
