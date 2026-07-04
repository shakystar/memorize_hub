# 파생물 사이드카 스토어 (der_) — Hub 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gateway가 부모 source store에 바인딩된 범용 "파생물 사이드카 스토어"(`der_`)를 mint·ACL 상속·프록시 통과시키는 Hub base를 짓는다. 첫 입주자 = 임베딩(self-벡터 크로스디바이스).

**Architecture:** relay는 무변경(der_는 여느 opaque ndjson 로그). gateway에 (1) 새 `der_` id 네임스페이스, (2) `derived_stores` 제어평면 테이블 + DAL, (3) `authorize()`가 der_를 만나면 **부모를 찾아 부모 ACL로 위임**하는 단일 지점, (4) `GET /v1/stores/:parent/derived/:kind` get-or-create discovery 엔드포인트, (5) owner teardown 시 사이드카 바인딩 cascade 삭제를 더한다. 데이터평면 push/pull은 기존 events 프록시를 그대로 탄다.

**Tech Stack:** TypeScript(ESM, `.js` import 확장자), `node:http`, better-sqlite3(WAL + `PRAGMA user_version` 마이그레이션), vitest.

## Global Constraints

- **relay/gateway에 임베딩·랭킹·projection·도메인 스키마 금지 (H010).** 벡터는 opaque 바이트로 **통과**만 한다 — gateway는 벡터를 파싱하지 않는다.
- **gateway DB는 제어평면 메타데이터만.** `derived_stores`는 `(parent, kind, der_ id)` 매핑만 담고, 벡터/이벤트 데이터는 절대 담지 않는다(relay ndjson에만 존재).
- **모든 remote store id는 서버-민팅 (H050).** `der_`는 예약 네임스페이스 — 절대 grant/clone/일반 project로 재해석 금지.
- **der_ store는 자기 membership이 없다.** 인가는 `authorize()`가 부모를 찾아 부모 멤버십/소유권으로 판정(H030 coarse ACL, 인가 단위 = store 하나 유지).
- **마이그레이션은 append-only.** `MIGRATIONS` 배열에 v6를 **추가**만 한다 — 기존 항목 재정렬·수정 금지(`db.ts` 주석).
- **작업 순서:** TDD(실패 테스트 먼저), 스텝마다 커밋, 정확한 파일 경로.
- **테스트 실행:** `pnpm --filter @shakystar/memorize-hub-gateway test <파일경로>` (스크립트 = `vitest run`). 타입체크: `pnpm --filter @shakystar/memorize-hub-gateway typecheck`.
- **브랜치:** `design/derived-sidecar-store` (이미 존재, spec 커밋됨). 여기에 이어서 커밋.
- **참조 spec:** `docs/superpowers/specs/2026-07-04-derived-sidecar-store-design.md`.

---

## File Structure

- `packages/gateway/src/ids.ts` — **수정**: `IdKind`에 `'der'` 추가, `isDerivedStoreId`, `isReservedId`에 der_ 포함.
- `packages/gateway/src/db.ts` — **수정**: `MIGRATIONS`에 v6 `derived_stores` 테이블 추가.
- `packages/gateway/src/derived-stores.ts` — **신규**: get-or-create + parent 역해석 + cascade 삭제 DAL (`personal-store.ts` 패턴 복제).
- `packages/gateway/src/policy.ts` — **수정**: `authorize()` store 분기에 der_ → 부모 위임.
- `packages/gateway/src/proxy.ts` — **수정**: `handleDerivedStore` discovery 핸들러 추가(`handlePersonalStore` 형제).
- `packages/gateway/src/server.ts` — **수정**: `/v1/stores/:parent/derived/:kind` 라우트 등록.
- `packages/gateway/src/stores.ts` — **수정**: `deleteStore` 트랜잭션에 사이드카 바인딩 cascade 삭제.
- `packages/gateway/tests/unit/ids.test.ts` — **신규**: der_ id 규칙.
- `packages/gateway/tests/unit/derived-stores.test.ts` — **신규**: DAL + cascade.
- `packages/gateway/tests/unit/policy-derived.test.ts` — **신규**: authorize 부모 위임.
- `packages/gateway/tests/unit/derived-store.test.ts` — **신규**: discovery 엔드포인트 + events 프록시 der_ 인가.
- `docs/protocol/derived-store.md` — **신규** (S2): 와이어 계약.
- `PROTOCOL.md` — **수정** (S2): 인덱스에 링크.

---

## Task 1: `der_` 식별자 (ids.ts)

**Files:**
- Modify: `packages/gateway/src/ids.ts`
- Test: `packages/gateway/tests/unit/ids.test.ts` (create)

**Interfaces:**
- Produces: `isDerivedStoreId(id: string): boolean`; `newId('der')` → `der_…`; `isReservedId('der_…')` → `true`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/gateway/tests/unit/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isDerivedStoreId, isReservedId, isValidStoreId, newId } from '../../src/ids.js';

describe('der_ derived-store ids', () => {
  it('mints a der_-prefixed, path-safe id', () => {
    const id = newId('der');
    expect(id.startsWith('der_')).toBe(true);
    expect(isValidStoreId(id)).toBe(true);
  });

  it('recognises der_ ids', () => {
    expect(isDerivedStoreId(newId('der'))).toBe(true);
    expect(isDerivedStoreId(newId('wsp'))).toBe(false);
    expect(isDerivedStoreId('psm_abc')).toBe(false);
  });

  it('reserves der_ so it is never granted or cloned as a plain project', () => {
    expect(isReservedId(newId('der'))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/ids.test.ts`
Expected: FAIL — `isDerivedStoreId` is not exported / `newId('der')` 타입 에러.

- [ ] **Step 3: 구현** — `packages/gateway/src/ids.ts` 세 곳 수정.

`IdKind`에 `'der'` 추가:

```ts
export type IdKind = 'acc' | 'tok' | 'wsp' | 'inv' | 'psm' | 'der';
```

프리픽스 상수 옆에 der_ 추가(`const INVITE_PREFIX = 'inv_';` 아래):

```ts
const DERIVED_STORE_PREFIX = 'der_';
```

`isWorkspaceStoreId` 아래에 판별 함수 추가:

```ts
export function isDerivedStoreId(id: string): boolean {
  return id.startsWith(DERIVED_STORE_PREFIX);
}
```

`isReservedId` 본문에 der_ 절 추가:

```ts
export function isReservedId(id: string): boolean {
  return (
    id.startsWith(PERSONAL_STORE_PREFIX) ||
    id.startsWith(WORKSPACE_STORE_PREFIX) ||
    id.startsWith(INVITE_PREFIX) ||
    id.startsWith(DERIVED_STORE_PREFIX)
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/ids.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add packages/gateway/src/ids.ts packages/gateway/tests/unit/ids.test.ts
git commit -m "feat(gateway): der_ derived-store id namespace"
```

---

## Task 2: `derived_stores` 마이그레이션 + DAL

**Files:**
- Modify: `packages/gateway/src/db.ts` (append v6 to `MIGRATIONS`)
- Create: `packages/gateway/src/derived-stores.ts`
- Test: `packages/gateway/tests/unit/derived-stores.test.ts` (create)

**Interfaces:**
- Consumes: `newId('der')` (Task 1).
- Produces:
  - `ARTIFACT_KINDS: Set<string>` (현재 `{'embedding'}`); `isArtifactKind(kind: string): boolean`.
  - `getOrCreateDerivedStore(db, parentStoreId, artifactKind): { storeId: string; createdAt: string }` — 멱등.
  - `getDerivedStoreParent(db, storeId): { parentStoreId: string; artifactKind: string } | null`.
  - `deleteDerivedStores(db, parentStoreId): void`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/gateway/tests/unit/derived-stores.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';
import {
  deleteDerivedStores,
  getDerivedStoreParent,
  getOrCreateDerivedStore,
  isArtifactKind,
} from '../../src/derived-stores.js';

const db = openGatewayDb(':memory:');

afterAll(() => db.close());

describe('derived_stores migration', () => {
  it('bumps user_version to 6 (v6 appended)', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(6);
  });
});

describe('artifact-kind allowlist', () => {
  it('accepts embedding, rejects unknown', () => {
    expect(isArtifactKind('embedding')).toBe(true);
    expect(isArtifactKind('bogus')).toBe(false);
  });
});

describe('getOrCreateDerivedStore', () => {
  it('mints a der_ store bound to (parent, kind)', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentA', 'embedding');
    expect(storeId.startsWith('der_')).toBe(true);
  });

  it('is idempotent for the same (parent, kind)', () => {
    const a = getOrCreateDerivedStore(db, 'wsp_parentB', 'embedding').storeId;
    const b = getOrCreateDerivedStore(db, 'wsp_parentB', 'embedding').storeId;
    expect(a).toBe(b);
  });

  it('gives distinct stores for distinct kinds under one parent', () => {
    const emb = getOrCreateDerivedStore(db, 'wsp_parentC', 'embedding').storeId;
    const fts = getOrCreateDerivedStore(db, 'wsp_parentC', 'fts-blob').storeId;
    expect(emb).not.toBe(fts);
  });
});

describe('getDerivedStoreParent', () => {
  it('resolves a der_ id to its parent binding', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentD', 'embedding');
    expect(getDerivedStoreParent(db, storeId)).toEqual({
      parentStoreId: 'wsp_parentD',
      artifactKind: 'embedding',
    });
  });

  it('returns null for an unknown id', () => {
    expect(getDerivedStoreParent(db, 'der_nope')).toBeNull();
  });
});

describe('deleteDerivedStores', () => {
  it('removes every sidecar binding of a parent', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentE', 'embedding');
    deleteDerivedStores(db, 'wsp_parentE');
    expect(getDerivedStoreParent(db, storeId)).toBeNull();
  });
});
```

> 주의: 테스트가 `'fts-blob'`을 DAL에 직접 넣는다 — DAL은 allowlist를 강제하지 않는다(그건 엔드포인트의 몫, Task 4). allowlist는 `isArtifactKind`로만 노출된다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-stores.test.ts`
Expected: FAIL — `../../src/derived-stores.js` 해석 불가 + user_version 5.

- [ ] **Step 3: 마이그레이션 v6 추가** — `packages/gateway/src/db.ts`의 `MIGRATIONS` 배열 **끝(v5 뒤)** 에 항목 추가. 기존 항목은 손대지 않는다:

```ts
  // v6 — derived-artifact sidecar stores (spec 2026-07-04-derived-sidecar-store,
  // docs/protocol/derived-store.md). A der_ store holds regenerable artifacts
  // (embeddings first) keyed to a PARENT source store's raw event ids. It has NO
  // memberships — authorize() resolves the parent and inherits its ACL (H030).
  // No FK on parent_store_id: the parent may be a wsp_ (stores) OR a psm_
  // (personal_stores), so the reference is validated at authorize time, not by SQL.
  // Control-plane metadata only; the vectors live opaque in the relay (H010).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS derived_stores (
        parent_store_id TEXT NOT NULL,
        artifact_kind   TEXT NOT NULL,
        store_id        TEXT NOT NULL UNIQUE,
        created_at      TEXT NOT NULL,
        PRIMARY KEY (parent_store_id, artifact_kind)
      );
      CREATE INDEX IF NOT EXISTS idx_derived_store_id ON derived_stores(store_id);
    `);
  },
```

- [ ] **Step 4: DAL 작성** — `packages/gateway/src/derived-stores.ts` (신규):

```ts
import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/**
 * Derived-artifact sidecar store DAL (spec 2026-07-04-derived-sidecar-store).
 * A der_ store is bound to exactly one PARENT source store + artifact_kind, holds
 * regenerable artifacts (embeddings first) that live opaque in the relay, and has
 * NO memberships of its own — authorize() inherits the parent's ACL (H030). One
 * store per (parent, kind); get-or-create is idempotent, mirroring
 * personal-store.ts.
 */

function nowIso(): string {
  return new Date().toISOString();
}

/** Artifact kinds a sidecar may hold. Extend the set as new tenants land. */
export const ARTIFACT_KINDS = new Set<string>(['embedding']);

export function isArtifactKind(kind: string): boolean {
  return ARTIFACT_KINDS.has(kind);
}

export interface DerivedStore {
  /** The relay path id (`der_…`) this artifact kind syncs under. */
  storeId: string;
  createdAt: string;
}

/** Get-or-create the sidecar store for (parentStoreId, artifactKind). Idempotent. */
export function getOrCreateDerivedStore(
  db: Database.Database,
  parentStoreId: string,
  artifactKind: string,
): DerivedStore {
  const existing = db
    .prepare(
      'SELECT store_id, created_at FROM derived_stores WHERE parent_store_id = ? AND artifact_kind = ?',
    )
    .get(parentStoreId, artifactKind) as { store_id: string; created_at: string } | undefined;
  if (existing) return { storeId: existing.store_id, createdAt: existing.created_at };
  const storeId = newId('der');
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO derived_stores (parent_store_id, artifact_kind, store_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(parentStoreId, artifactKind, storeId, createdAt);
  return { storeId, createdAt };
}

/** Resolve a der_ store id to its parent binding, or null if unknown. */
export function getDerivedStoreParent(
  db: Database.Database,
  storeId: string,
): { parentStoreId: string; artifactKind: string } | null {
  const row = db
    .prepare('SELECT parent_store_id, artifact_kind FROM derived_stores WHERE store_id = ?')
    .get(storeId) as { parent_store_id: string; artifact_kind: string } | undefined;
  return row ? { parentStoreId: row.parent_store_id, artifactKind: row.artifact_kind } : null;
}

/** Delete every sidecar binding of a parent store (owner teardown cascade). */
export function deleteDerivedStores(db: Database.Database, parentStoreId: string): void {
  db.prepare('DELETE FROM derived_stores WHERE parent_store_id = ?').run(parentStoreId);
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-stores.test.ts`
Expected: PASS (전 테스트).

- [ ] **Step 6: 커밋**

```bash
git add packages/gateway/src/db.ts packages/gateway/src/derived-stores.ts packages/gateway/tests/unit/derived-stores.test.ts
git commit -m "feat(gateway): derived_stores table + get-or-create DAL (v6)"
```

---

## Task 3: `authorize()` 부모 위임 (policy.ts)

**Files:**
- Modify: `packages/gateway/src/policy.ts`
- Test: `packages/gateway/tests/unit/policy-derived.test.ts` (create)

**Interfaces:**
- Consumes: `getDerivedStoreParent` (Task 2), `isDerivedStoreId` (Task 1), `authorize`, `createStore`/`addMember` (stores.ts), `getOrCreatePersonalStore` (personal-store.ts).
- Behavior: `authorize(db, principal, { kind: 'store', storeId: der_ }, action)` == `authorize(db, principal, { kind: 'store', parentStoreId }, action)`. 미등록 der_ → `{ ok: false, status: 403 }`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/gateway/tests/unit/policy-derived.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';
import { upsertAccountByEmail } from '../../src/accounts.js';
import { getOrCreateDerivedStore } from '../../src/derived-stores.js';
import { getOrCreatePersonalStore } from '../../src/personal-store.js';
import type { Principal } from '../../src/principal.js';
import { authorize } from '../../src/policy.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
afterAll(() => db.close());

const owner = upsertAccountByEmail(db, 'owner@derived.example');
const outsider = upsertAccountByEmail(db, 'outsider@derived.example');
const { storeId: wsp } = createStore(db, owner, 'parent');
const wspDerived = getOrCreateDerivedStore(db, wsp, 'embedding').storeId;
const psm = getOrCreatePersonalStore(db, owner).storeId;
const psmDerived = getOrCreateDerivedStore(db, psm, 'embedding').storeId;

function principal(accountId: string, over: Partial<Principal> = {}): Principal {
  return { accountId, via: 'key', readOnly: false, scoped: false, ...over };
}

describe('authorize() derived-store parent delegation', () => {
  it('mirrors a wsp_ parent: member may read+write its sidecar', () => {
    expect(authorize(db, principal(owner), { kind: 'store', storeId: wspDerived }, 'read').ok).toBe(true);
    expect(authorize(db, principal(owner), { kind: 'store', storeId: wspDerived }, 'write').ok).toBe(true);
  });

  it('mirrors a wsp_ parent: a non-member is denied the sidecar', () => {
    const d = authorize(db, principal(outsider), { kind: 'store', storeId: wspDerived }, 'read');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it('mirrors a psm_ parent: owner allowed, others denied', () => {
    expect(authorize(db, principal(owner), { kind: 'store', storeId: psmDerived }, 'read').ok).toBe(true);
    expect(authorize(db, principal(outsider), { kind: 'store', storeId: psmDerived }, 'read').ok).toBe(false);
  });

  it('inherits read-only narrowing from the top gate', () => {
    const d = authorize(db, principal(owner, { readOnly: true }), { kind: 'store', storeId: wspDerived }, 'write');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it('denies an unregistered der_ id (unknown parent)', () => {
    const d = authorize(db, principal(owner), { kind: 'store', storeId: 'der_unknown' }, 'read');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/policy-derived.test.ts`
Expected: FAIL — der_ 는 현재 `authorize`의 `'unknown store'` 절로 떨어져 wsp/psm 위임 안 됨(멤버도 403).

- [ ] **Step 3: 구현** — `packages/gateway/src/policy.ts`.

import 추가(기존 ids import 줄에 `isDerivedStoreId` 넣고, derived-stores import 추가):

```ts
import { isDerivedStoreId, isPersonalStoreId, isWorkspaceStoreId } from './ids.js';
import { getDerivedStoreParent } from './derived-stores.js';
```

`if (resource.kind === 'store') {` 블록에서 `const { storeId } = resource;` **바로 다음**, personal 분기 앞에 위임 절 추가:

```ts
    // Derived sidecar store: no memberships of its own — resolve the parent and
    // inherit its ACL wholesale (personal owner-only OR workspace membership∩scope).
    // Recursion depth is 1: a parent is never itself a der_ store.
    if (isDerivedStoreId(storeId)) {
      const parent = getDerivedStoreParent(db, storeId);
      if (!parent) return { ok: false, status: 403, error: 'unknown store' };
      return authorize(db, principal, { kind: 'store', storeId: parent.parentStoreId }, action);
    }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/policy-derived.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add packages/gateway/src/policy.ts packages/gateway/tests/unit/policy-derived.test.ts
git commit -m "feat(gateway): authorize() inherits parent ACL for der_ sidecar stores"
```

---

## Task 4: discovery 엔드포인트 + 라우트

**Files:**
- Modify: `packages/gateway/src/proxy.ts` (add `handleDerivedStore`)
- Modify: `packages/gateway/src/server.ts` (route)
- Test: `packages/gateway/tests/unit/derived-store.test.ts` (create)

**Interfaces:**
- Consumes: `getOrCreateDerivedStore`, `isArtifactKind` (Task 2), `authorize` (Task 3), `resolveKeyPrincipal`, `isValidStoreId`, `touchToken`, `sendJson`, `sendError`.
- Produces endpoint: `GET /v1/stores/:parentStoreId/derived/:artifactKind` → `200 { storeId: "der_…", eventsUrl: "/v1/projects/der_…/events" }`. 인가: 부모 store에 `read`. 데이터평면 push/pull은 기존 `/v1/projects/:der_/events` 프록시가 처리(코드 변경 없음 — Task 3의 위임으로 동작).

- [ ] **Step 1: 실패 테스트 작성** — `packages/gateway/tests/unit/derived-store.test.ts`:

```ts
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
const server = createGatewayServer({ db, config: loadGatewayConfig({}) });
let base = '';

const alice = upsertAccountByEmail(db, 'alice@derived.example');
const bob = upsertAccountByEmail(db, 'bob@derived.example');
const { storeId: wsp } = createStore(db, alice, 'alice-parent'); // alice = owner
const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const bobKey = issueApiKey(db, bob, 'bob').plaintext; // non-member of wsp

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

function auth(key: string) {
  return { authorization: `Bearer ${key}` };
}
function discover(key: string | null, parent: string, kind: string) {
  return fetch(`${base}/v1/stores/${encodeURIComponent(parent)}/derived/${encodeURIComponent(kind)}`, {
    headers: key ? auth(key) : {},
  });
}

describe('GET /v1/stores/:parent/derived/:kind discovery', () => {
  it('401s without a key', async () => {
    expect((await discover(null, wsp, 'embedding')).status).toBe(401);
  });

  it('400s an invalid parent store id', async () => {
    expect((await discover(aliceKey, 'bad/id', 'embedding')).status).toBe(400);
  });

  it('400s an unknown artifact kind', async () => {
    expect((await discover(aliceKey, wsp, 'bogus')).status).toBe(400);
  });

  it('403s a non-member of the parent', async () => {
    expect((await discover(bobKey, wsp, 'embedding')).status).toBe(403);
  });

  it('provisions and returns a der_ id for a parent member', async () => {
    const res = await discover(aliceKey, wsp, 'embedding');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storeId: string; eventsUrl: string };
    expect(body.storeId.startsWith('der_')).toBe(true);
    expect(body.eventsUrl).toBe(`/v1/projects/${body.storeId}/events`);
  });

  it('is idempotent — same (parent, kind) resolves the same der_', async () => {
    const a = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    const b = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    expect(a.storeId).toBe(b.storeId);
  });
});

describe('data-plane events proxy honours der_ (parent-delegated ACL)', () => {
  it('401s the der_ events route without a key', async () => {
    const { storeId } = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    expect((await fetch(`${base}/v1/projects/${storeId}/events`)).status).toBe(401);
  });

  it('403s a non-member on the der_ events route', async () => {
    const { storeId } = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    const res = await fetch(`${base}/v1/projects/${storeId}/events`, { headers: auth(bobKey) });
    expect(res.status).toBe(403);
  });
});
```

> 인가된 멤버의 실제 push/pull(성공 경로)은 relay가 있어야 하므로 여기서 안 다룬다 — 기존 `personal-store.test.ts`가 데이터평면 성공 경로를 e2e로 미루는 것과 동일한 스코핑.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-store.test.ts`
Expected: FAIL — 라우트 없음 → discovery가 404.

- [ ] **Step 3: 핸들러 추가** — `packages/gateway/src/proxy.ts`.

import 보강: 기존 `getOrCreatePersonalStore` import 아래에 추가, 그리고 derived-stores import:

```ts
import { getOrCreateDerivedStore, isArtifactKind } from './derived-stores.js';
```

파일 끝에 핸들러 추가(`handlePersonalStore` 형제):

```ts
/**
 * GET /v1/stores/:parentStoreId/derived/:artifactKind — resolve (or provision on
 * first call) the sidecar store that carries a regenerable artifact for a parent
 * source store (spec 2026-07-04-derived-sidecar-store; docs/protocol/derived-store.md).
 * Discovery only needs READ on the parent; pushing derived events to the returned
 * der_ store is separately gated at the events proxy, where authorize() delegates
 * to the parent (write => non-read-only member ∩ key scope).
 */
export function handleDerivedStore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  parentStoreId: string,
  artifactKind: string,
): void {
  const principal = resolveKeyPrincipal(ctx.db, req);
  if (!principal) {
    sendError(res, 401, 'missing or invalid API key');
    return;
  }
  if (!isValidStoreId(parentStoreId)) {
    sendError(res, 400, 'invalid store id');
    return;
  }
  if (!isArtifactKind(artifactKind)) {
    sendError(res, 400, 'unknown artifact kind');
    return;
  }
  const decision = authorize(ctx.db, principal, { kind: 'store', storeId: parentStoreId }, 'read');
  if (!decision.ok) {
    sendError(res, decision.status, decision.error ?? 'forbidden');
    return;
  }
  const { storeId } = getOrCreateDerivedStore(ctx.db, parentStoreId, artifactKind);
  if (principal.tokenId) touchToken(ctx.db, principal.tokenId);
  sendJson(res, 200, { storeId, eventsUrl: `/v1/projects/${storeId}/events` });
}
```

- [ ] **Step 4: 라우트 등록** — `packages/gateway/src/server.ts`.

프록시 import 줄을 수정:

```ts
import { handleDerivedStore, handleEventsProxy, handlePersonalStore } from './proxy.js';
```

라우트 패턴 상수 추가(`const WS_MEMBER = ...` 근처, 상수 블록):

```ts
const DERIVED_STORE = /^\/v1\/stores\/([^/]+)\/derived\/([^/]+)$/;
```

account discovery 절, personal-store 라인 **바로 아래**에 디스패치 추가:

```ts
  const derived = DERIVED_STORE.exec(p);
  if (derived && method === 'GET') {
    return handleDerivedStore(req, res, ctx, decode(derived[1]), decode(derived[2]));
  }
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-store.test.ts`
Expected: PASS (전 테스트).

- [ ] **Step 6: 커밋**

```bash
git add packages/gateway/src/proxy.ts packages/gateway/src/server.ts packages/gateway/tests/unit/derived-store.test.ts
git commit -m "feat(gateway): der_ sidecar discovery endpoint + route"
```

---

## Task 5: owner teardown cascade (stores.ts)

**Files:**
- Modify: `packages/gateway/src/stores.ts` (`deleteStore`)
- Test: `packages/gateway/tests/unit/derived-stores.test.ts` (append)

**Interfaces:**
- Consumes: `deleteDerivedStores` (Task 2), `createStore`/`deleteStore` (stores.ts).
- Behavior: `deleteStore(db, parent)`가 그 부모의 모든 `derived_stores` 행도 같은 트랜잭션에서 삭제.

- [ ] **Step 1: 실패 테스트 추가** — `packages/gateway/tests/unit/derived-stores.test.ts` 끝에 append. 상단 import에 추가:

```ts
import { upsertAccountByEmail } from '../../src/accounts.js';
import { createStore, deleteStore } from '../../src/stores.js';
```

파일 끝에 describe 추가:

```ts
describe('deleteStore cascade', () => {
  it('drops the parent store’s sidecar bindings', () => {
    const owner = upsertAccountByEmail(db, 'teardown@derived.example');
    const { storeId: parent } = createStore(db, owner, 'to-delete');
    const der = getOrCreateDerivedStore(db, parent, 'embedding').storeId;
    deleteStore(db, parent);
    expect(getDerivedStoreParent(db, der)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-stores.test.ts`
Expected: FAIL — der_ 바인딩이 남아 `getDerivedStoreParent`가 non-null.

- [ ] **Step 3: 구현** — `packages/gateway/src/stores.ts`.

import 추가(파일 상단, `import { newId } from './ids.js';` 아래):

```ts
import { deleteDerivedStores } from './derived-stores.js';
```

`deleteStore`의 트랜잭션에 사이드카 삭제 한 줄 추가:

```ts
export function deleteStore(db: Database.Database, storeId: string): void {
  const write = db.transaction(() => {
    db.prepare('DELETE FROM invites WHERE store_id = ?').run(storeId);
    db.prepare('DELETE FROM memberships WHERE store_id = ?').run(storeId);
    deleteDerivedStores(db, storeId);
    db.prepare('DELETE FROM stores WHERE store_id = ?').run(storeId);
  });
  write();
}
```

> relay ndjson 로그의 물리적 GC는 이번 스코프 밖이다(retention = Hub "Later"). 이 스텝은 제어평면 바인딩만 정리한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway test tests/unit/derived-stores.test.ts`
Expected: PASS (cascade 포함 전 테스트).

- [ ] **Step 5: 전체 게이트웨이 체크**

Run: `pnpm --filter @shakystar/memorize-hub-gateway check`
Expected: typecheck + lint + 전 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/gateway/src/stores.ts packages/gateway/tests/unit/derived-stores.test.ts
git commit -m "feat(gateway): cascade-delete sidecar bindings on store teardown"
```

---

## Task 6: 와이어 계약 문서화 (S2)

**Files:**
- Create: `docs/protocol/derived-store.md`
- Modify: `PROTOCOL.md` (인덱스 링크)

**Interfaces:** 코드 없음 — 문서. 엔드포인트·인가·페이로드 규약을 Task 1-5 구현과 **일치**하게 기술.

- [ ] **Step 1: 계약 문서 작성** — `docs/protocol/derived-store.md`:

```markdown
# 파생물 사이드카 스토어 (der_) — 와이어 계약

> 상태: v1. 권위 spec: `docs/superpowers/specs/2026-07-04-derived-sidecar-store-design.md`.
> 불변: relay/gateway는 벡터를 **통과**만 한다(H010); der_는 자기 membership이 없고
> 인가는 부모 store ACL을 상속한다(H030).

## 개념

`der_` store는 **부모 source store**(`wsp_` 또는 `psm_`)에 바인딩된, 재생성 가능한
파생 아티팩트(첫 입주자 = 임베딩) 전용 opaque 로그다. 부모 store의 raw `event.id`로
키잉된 이벤트를 나른다. relay 입장에선 여느 ndjson 로그와 동일하다.

## Discovery / provisioning

```
GET /v1/stores/:parentStoreId/derived/:artifactKind
Authorization: Bearer <api-key>

200 { "storeId": "der_…", "eventsUrl": "/v1/projects/der_…/events" }
```

- get-or-create: `(parentStoreId, artifactKind)`당 정확히 하나, 멱등.
- `artifactKind` ∈ { `embedding` } (allowlist; 새 입주자 추가 시 확장).
- 인가: 호출자가 **부모 store에 read** 가능해야 함(멤버십/소유권 상속).
- 오류: 키 없음 `401`; 잘못된 부모 id `400`; 모르는 kind `400`; 부모 비인가 `403`.

## 데이터평면 (push / pull)

반환된 `eventsUrl`(`/v1/projects/:der_/events`)로 **기존 events 프록시**를 그대로 쓴다.
별도 경로·envelope 없음.

- 인가는 `der_`의 부모로 위임된다: push(write)는 **non-read-only 멤버 ∩ 키 스코프**,
  pull(read)은 멤버. 부모가 `psm_`면 owner-only + unscoped 키.
- E2E opt-in 워크스페이스: 벡터도 `{__enc:…}` 봉투로 실린다(H070) — 서버는 못 읽는다.
- 페이로드(도메인/클라이언트 규약, relay엔 opaque): source raw `event.id` +
  `model id/version/dim` 태그. 소비 기기는 모델 일치 시만 재사용, 아니면 재임베딩.

## teardown

부모 store 삭제 시 gateway가 그 부모의 der_ 바인딩을 cascade 삭제한다(제어평면). relay
로그의 물리적 GC(retention/compaction)는 별도 "Later" 항목이다.

## 비목표

파생물 **계산·색인·읽기**는 Hub가 하지 않는다 — memorize 클라이언트/H060 replica의 몫
(spec §7). gateway는 mint·인가·프록시만.
```

- [ ] **Step 2: 인덱스 링크** — `PROTOCOL.md`에서 `docs/protocol/` 하위 문서 목록에 한 줄 추가(기존 목록 형식에 맞춰):

```markdown
- [파생물 사이드카 스토어 (der_)](docs/protocol/derived-store.md) — 부모에 바인딩된 파생 아티팩트(임베딩) 전송 계약.
```

> `PROTOCOL.md`의 실제 목록 형식을 먼저 확인해 그 스타일에 맞춘다(불릿/표 등).

- [ ] **Step 3: 커밋**

```bash
git add docs/protocol/derived-store.md PROTOCOL.md
git commit -m "docs(protocol): derived-artifact sidecar store wire contract"
```

---

## Self-Review

**1. Spec coverage** (spec §1-§10 대비):
- §2 프리미티브(der_ id, derived_stores, get-or-create DAL) → Task 1, 2. ✓
- §3 ACL 상속(authorize 부모 위임) → Task 3. ✓
- §3 teardown cascade → Task 5. ✓
- §4 discovery 엔드포인트 + 프록시 통과 → Task 4. ✓
- §4/§5/§6 와이어·페이로드·E2E 규약 → Task 6 문서. ✓
- §5 relay 무변경 → 어떤 Task도 relay 패키지를 건드리지 않음(설계상). ✓
- §7 비목표(임베딩 계산·색인·읽기 Hub 밖) → 코드에 없음; Task 6에 명시. ✓
- §8 cross-repo 클라이언트 작업 → **이 계획 밖**(memorize `taskreq_mr5p1r5p_8eztee3c`로 위임됨). ✓
- §5 벡터 바이트 쿼터(usage_daily) → 옵션/연기, 이번 스코프 제외(기존 프록시 metering이 der_ push도 자동 계량하므로 추가 코드 불요). ✓

**2. Placeholder scan:** 모든 스텝에 실제 코드/명령 존재. TBD·"적절히 처리" 없음. ✓

**3. Type consistency:**
- `getOrCreateDerivedStore` 반환 `{ storeId, createdAt }` — Task 2 정의, Task 4/5에서 `.storeId` 사용. ✓
- `getDerivedStoreParent` 반환 `{ parentStoreId, artifactKind } | null` — Task 2 정의, Task 3에서 `.parentStoreId` 사용. ✓
- `isArtifactKind` — Task 2 정의, Task 4에서 사용. ✓
- `Principal` = `{ accountId, via, readOnly, scoped, tokenId? }` — Task 3 테스트 literal이 실제 인터페이스와 일치. ✓
- `authorize(db, principal, { kind:'store', storeId }, action)` 시그니처 — 기존 policy.ts와 일치. ✓
```
