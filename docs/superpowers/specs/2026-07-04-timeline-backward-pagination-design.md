# Timeline backward pagination — design

- **Date:** 2026-07-04
- **Task:** `task_mr53nnmm_sbgxornt` — [bug] 타임라인 최상단, today 위 오래된 기억이 로드/추적 안 됨
- **Co-design:** `task_mr53no79_z0ahgm5v` (날짜점프 캘린더) reuses the cursor contract; its UI is out of scope here.
- **Status:** approved design, pre-implementation

## Problem

The workspace timeline only ever shows the newest slice of memories. Scrolling
to the top never reveals older ones. Root cause traced through the data flow:

```
TimelineTab            renders every prop item, no pagination
  <- WorkspaceCanvas.useLiveFeed
  <- api.ts:105        getWorkspaceTimeline(id, limit = 100)   // web hardcodes newest-100
  <- gateway timeline.ts                                       // forwards limit only
  <- replica timeline.ts:110  items.slice(-params.limit)       // returns newest N, no cursor
```

`replica/src/timeline.ts:110` sorts all memories ascending then keeps the last
`N`. The browser requests `limit=100` and auto-scrolls to the bottom on mount,
so anything older than the newest 100 is never fetched and there is no `before`
cursor to page backward. This is a missing feature (backward pagination), not a
one-line off-by-one.

## Scope

**In:** cursor-based backward (older) pagination end to end — replica projection,
gateway passthrough, web data hook, and TimelineTab scroll integration. The
cursor contract is designed so the date-jump task can reuse it unchanged.

**Out:** the calendar date-jump UI and "jump to arbitrary date D" loading
(`mr53no79`); read-lane incremental caching (see Known cost below).

## Why cursor `(at, id)` is the stable choice

The timeline projection is **not immutable**. `readTimeline` runs a full
`pullProject` from the relay and re-projects on every read, and memories can be
**retracted** (removed). Any pagination scheme must tolerate the underlying set
changing between page fetches. The `(at, id)` strict-less-than cursor does:

- **No duplicates across pages.** Page 1's `nextCursor` is its oldest item `X`;
  page 2 is `(at,id) < X`. Even against a different snapshot, strict `<` cannot
  overlap. Dedup by `id` on merge is a belt-and-suspenders backstop.
- **Survives boundary deletion.** If cursor item `X` is retracted, `before=X`
  still works — the filter is a pure comparison; `X` need not exist.
- **Total order.** `at` = `memory.createdAt` (ISO-8601); ties broken by unique
  `id`. This is exactly the existing `byAscendingTimeline` order. An `at`-only
  cursor could skip/duplicate items sharing a timestamp — the `id` component is
  required.
- **Offset pagination would be unstable** — inserts/retractions shift offsets and
  cause skip/duplicate. Cursor is strictly better.

`useLiveFeed` fetches **once per mount** (no polling), so within a session there
is no "newest refresh racing a prepended older page." Revisiting a tab resets to
the newest page and scroll-up reloads older pages — simple and predictable.

## ① Endpoint contract (replica + gateway)

**Cursor:** encodes the boundary item's `(at, id)`, base64-encoded on the wire
so timestamp `:`/`+` need no query escaping and the client treats it as opaque
(never parses it).

- `encodeCursor({ at, id }) = base64url(`${at}|${id}`)`
- `decodeCursor(s)` splits on the first `|` (ISO timestamps and `mem_…` ids
  contain no `|`).

**replica `GET /v1/workspaces/:id/timeline`:**

- Query params: `limit` (positive int, default 50), `before` (optional cursor).
- `before` absent → newest `limit` items (current `slice(-limit)` behavior).
- `before` present → filter to items with `(at,id) < cursor`, then take the
  newest `limit` of those.
- Response gains two fields (existing shape otherwise unchanged):

  ```jsonc
  {
    "storeId": "...",
    "pulled": { /* SyncPullResult */ },
    "items": [ /* ascending (at,id) — current display order */ ],
    "nextCursor": "<opaque>",  // oldest item of THIS page; omitted when hasMore=false
    "hasMore": true            // are there older items beyond this page?
  }
  ```

- All slicing is in-memory over the already-loaded projection. **memorize core
  and the relay package are unchanged.**

`readTimeline` changes (`packages/replica/src/timeline.ts`): after the existing
sort, replace the final `items.slice(-limit)` with a cursor-aware windowing
helper that returns `{ items, nextCursor, hasMore }`. The default-limit is 50.
The `limit` validation (positive integer) stays; add symmetric `before`
decode-failure handling (400 on malformed cursor at the server layer).

**gateway `GET /v1/workspaces/:id/timeline` (`packages/gateway/src/timeline.ts`):**

- `handleWorkspaceTimeline` currently forwards only `limit`. Also forward
  `before`.
- `labelMembers` already rebuilds the body as `{ ...body, items }`, so top-level
  `nextCursor`/`hasMore` pass through untouched. No change needed there; add a
  test that pins it.

**Date-jump reuse:** because the cursor is `at`-based, `mr53no79` can synthesize
a cursor from a calendar date (`startOfDay(D)` + a high/low id sentinel) and hit
the same windowing helper. Not built here.

## ② Web data hook — `usePaginatedTimeline`

`useLiveFeed` (whole-list replace) stays as-is for the Tasks tab. Timeline moves
to a dedicated hook so the pagination state never destabilizes the shared,
#58-hardened fetch hook.

- **File:** `packages/web/src/lib/paginated-timeline.ts`
- **Returns:** `{ items, loading, error, hasMore, loadingOlder, loadOlder }`.
- **Mount:** paint from sessionStorage cache (newest page) instantly, then fetch
  the newest page (stale-while-revalidate). Set `items`, `hasMore`, and the
  oldest-cursor from the response. `loading` is true only with an empty cache.
- **`loadOlder()`:** guarded by `hasMore && !loadingOlder`. Fetch
  `before=<oldestCursor>`, **prepend** the page, update `oldestCursor` and
  `hasMore`. Merge is union-by-`id` then re-sort by `(at,id)` (dedup backstop).
- **Cache:** only the **newest page** is mirrored to sessionStorage (instant
  paint on reload, same policy as `useLiveFeed`). Older pages are session-
  ephemeral and re-fetched on demand.
- **Keying:** same `hub:timeline:<workspaceId>` cache key; a workspace switch
  resets accumulated older pages (activeKey guard, as in `useLiveFeed`).

`api.ts`: `getWorkspaceTimeline(id, { limit?, before? })` returns
`{ items, nextCursor?, hasMore }`. Drop the hardcoded `limit = 100` default; the
hook owns page size (50).

## ③ TimelineTab scroll integration

- **Own the scroll container.** The real scroll region today is
  `WorkspaceCanvas`'s `min-h-0 flex-1 overflow-y-auto` ancestor (line 106). Move
  scroll ownership **into TimelineTab** so anchor math targets the element
  TimelineTab controls; the boundary stays clean (each tab scrolls itself).
- **Top sentinel + IntersectionObserver.** A `<div ref={topRef}>` above the day
  sections; when it intersects, call `onLoadOlder()`. Guard re-entry with
  `loadingOlder`; stop at `hasMore === false`. Immediate-fire on short content is
  desired (fills the viewport) and self-terminates.
- **Scroll-anchor preservation.** Before a prepend, record the scroll
  container's `scrollHeight`; in `useLayoutEffect` after the prepend, set
  `scrollTop += (newScrollHeight - oldScrollHeight)` so the viewport stays on the
  same item instead of jumping.
- **Fix the latent bottom-scroll bug.** The current
  `useEffect(scrollIntoView, [visible.length])` snaps to the bottom on *any*
  length change, so an older-page prepend would yank the user back down. Change
  it to auto-scroll to the bottom **only on first load / a new newest-tail**,
  never on an older prepend.
- **Props.** TimelineTab additionally receives `hasMore`, `loadingOlder`, and
  `onLoadOlder`; `WorkspaceCanvas` wires them from the hook. A small "loading
  older…" affordance renders at the top while `loadingOlder`.

## ④ Testing

- **replica unit** (`tests/unit/timeline.test.ts`, extend): cursor windowing —
  no-`before` returns newest page + `hasMore`/`nextCursor`; `before` returns the
  next older page with no overlap; exact boundary and `(at,id)` tie-break; last
  page sets `hasMore=false` and omits `nextCursor`; malformed cursor → error.
  Uses the existing `fakeHub` harness; seed >`limit` memories with distinct and
  tied timestamps.
- **gateway unit** (`tests/unit/timeline.test.ts`, extend): `before` is
  forwarded to the replica URL; `nextCursor`/`hasMore` survive `labelMembers`.
- **web unit**: hook prepend + union-by-`id` dedup + `hasMore`/cursor
  transitions; guard prevents concurrent `loadOlder`.
- **manual / `/verify`**: drive the real timeline with >50 memories — scroll to
  top loads older pages, viewport anchor holds (no jump), reaching the oldest
  stops loading, initial mount still lands at the newest item.
- **regression:** `pnpm -r check` green across relay/replica/gateway/web; e2e
  suite unaffected (contract is additive).

## Known cost (not a scope cut)

Every page fetch triggers a full relay `pullProject` + re-projection in the
replica. Fine at beta scale (hundreds of memories); at thousands+ each page adds
latency. The fix is read-lane incremental caching, tracked as a follow-up after
`mr53no79` — explicitly deferred, not silently dropped.

## Files touched

- `packages/replica/src/timeline.ts` — cursor windowing + response fields
- `packages/replica/src/server.ts` — parse/validate `before`, 400 on malformed
- `packages/gateway/src/timeline.ts` — forward `before`
- `packages/web/src/lib/api.ts` — options arg + response type, drop `limit=100`
- `packages/web/src/lib/paginated-timeline.ts` — new hook
- `packages/web/src/components/canvas/WorkspaceCanvas.tsx` — wire hook, scroll ownership
- `packages/web/src/components/canvas/TimelineTab.tsx` — sentinel, anchor, bottom-scroll fix, props
- `packages/web/src/lib/domain.ts` — timeline response type (if centralized)
- tests as in §④
