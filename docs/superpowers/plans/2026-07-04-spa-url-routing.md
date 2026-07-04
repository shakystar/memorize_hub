# SPA URL 라우팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게이트웨이 웹 SPA(`/app`)에서 워크스페이스 선택과 활성 탭을 경로 기반 URL에 반영해, 새로고침·공유 링크에서 상태를 복원한다.

**Architecture:** History API 위에 얹은 손수 만든 `useAppLocation()` 훅이 `{view, workspaceId, tab}` 라우트를 URL(`/app/:workspaceId/:tab`, `/app/personal`)과 양방향 동기화한다. `parse`/`toPath`는 순수 함수(테스트 대상)이고, `App`은 로드 후 라우트를 실제 워크스페이스 목록에 대조해 교정(리컨실리에이션)한다. react-router는 도입하지 않는다.

**Tech Stack:** React 19, Vite 7, TypeScript, vitest(신규 devDep, 순수 함수 유닛 테스트용).

## Global Constraints

- 대상 패키지는 `packages/web`만. `packages/relay`·`packages/gateway`는 건드리지 않는다(spa.ts의 `/app/*` → index.html 폴백은 이미 존재).
- 신규 **런타임** 의존성 없음. react-router 미도입(설계 확정). vitest는 devDependency만 추가.
- URL엔 렌더 슬러그가 아니라 안정적 `wsp_` id를 쓴다.
- import 별칭: `@/` → `packages/web/src/`.
- `Tab` 유니온은 정확히 `'timeline' | 'tasks' | 'talk' | 'decisions' | 'sources' | 'connect'`.
- 스펙: `docs/superpowers/specs/2026-07-04-spa-url-routing-design.md`.

## 파일 구조

- **생성** `packages/web/src/lib/tabs.ts` — `Tab` 유니온, `TABS` 메타, `isTab` 가드. (현재 `WorkspaceCanvas`에 흩어진 탭 정의를 여기로 모아 훅과 공유; 순환 import 방지)
- **생성** `packages/web/src/lib/use-app-location.ts` — `Route`, `parse`, `toPath`, `useAppLocation`.
- **생성** `packages/web/src/lib/use-app-location.test.ts` — `parse`/`toPath` 유닛 테스트.
- **수정** `packages/web/vite.config.ts` — vitest `test` 블록 추가(`vitest/config`).
- **수정** `packages/web/package.json` — vitest devDep + `test` 스크립트를 `vitest run`으로.
- **수정** `packages/web/src/components/canvas/WorkspaceCanvas.tsx` — controlled 탭(`tab`+`onTabChange` props), 로컬 탭 상태/`initialTab`/`?tab=` 제거, `tabs.ts` 사용.
- **수정** `packages/web/src/App.tsx` — `useAppLocation()` 배선, `selectedId`/`view` 상태 제거, 리컨실리에이션 이펙트.

명령은 모두 `packages/web`에서 실행한다(워크트리: `C:/dev/active/memorize_hub-spa-routing`).

---

### Task 1: vitest 하네스 + `tabs.ts`

탭 정의를 공유 모듈로 뽑고, 그 `isTab` 가드로 vitest 하네스가 실제로 도는지 증명한다.

**Files:**
- Create: `packages/web/src/lib/tabs.ts`
- Create: `packages/web/src/lib/tabs.test.ts`
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/package.json`

**Interfaces:**
- Produces: `type Tab`; `const TABS: Array<{ id: Tab; label: string; tbd?: boolean }>`; `function isTab(x: string | null | undefined): x is Tab`.

- [ ] **Step 1: vitest devDep 추가**

`packages/web`에서 실행:
```bash
pnpm add -D vitest@^3.0.0
```
Expected: `package.json`의 devDependencies에 `vitest`가 추가된다.

- [ ] **Step 2: `package.json`의 test 스크립트 교체**

`packages/web/package.json`의 scripts에서:
```json
    "test": "echo \"(web: no unit tests yet)\"",
```
를 다음으로 바꾼다:
```json
    "test": "vitest run",
```

- [ ] **Step 3: `vite.config.ts`에 vitest test 블록 추가**

`packages/web/vite.config.ts` 첫 import를 `vite` → `vitest/config`로 바꾸고(별칭 resolve를 그대로 공유), `build` 아래에 `test` 블록을 추가한다. 순수 함수 테스트라 jsdom 불필요 — node 환경.

변경 전:
```ts
import { defineConfig } from 'vite';
```
변경 후:
```ts
import { defineConfig } from 'vitest/config';
```
그리고 `build: { outDir: 'dist', emptyOutDir: true },` 다음 줄에 추가:
```ts
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
```

- [ ] **Step 4: 실패 테스트 작성 — `tabs.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { isTab } from '@/lib/tabs';

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
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `@/lib/tabs` 모듈을 못 찾음(아직 `tabs.ts` 없음).

- [ ] **Step 6: `tabs.ts` 구현**

```ts
/**
 * The workspace canvas tabs, in one place so both the canvas (rendering) and
 * the URL router (validation) share a single source of truth. `connect` is a
 * real tab but renders separately (right-aligned, non-demo only), so it lives
 * in the union + isTab guard but not in the left-aligned TABS list.
 */
export type Tab = 'timeline' | 'tasks' | 'talk' | 'decisions' | 'sources' | 'connect';

export const TABS: Array<{ id: Tab; label: string; tbd?: boolean }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'talk', label: 'Talk', tbd: true },
  { id: 'decisions', label: 'Decisions', tbd: true },
  { id: 'sources', label: 'Sources', tbd: true },
];

const TAB_IDS: readonly string[] = [...TABS.map((t) => t.id), 'connect'];

export function isTab(x: string | null | undefined): x is Tab {
  return x != null && TAB_IDS.includes(x);
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS (2 tests).

- [ ] **Step 8: 커밋**

```bash
git add packages/web/src/lib/tabs.ts packages/web/src/lib/tabs.test.ts packages/web/vite.config.ts packages/web/package.json ../../pnpm-lock.yaml
git commit -m "test(web): add vitest harness + shared tabs.ts module"
```
(락파일 경로가 다르면 `git add -A packages/web` 후 루트 `pnpm-lock.yaml`을 함께 스테이지.)

---

### Task 2: `use-app-location.ts` — parse/toPath/useAppLocation

URL ↔ 라우트 변환의 순수 코어와 그 위 얇은 훅.

**Files:**
- Create: `packages/web/src/lib/use-app-location.ts`
- Create: `packages/web/src/lib/use-app-location.test.ts`

**Interfaces:**
- Consumes: `type Tab`, `isTab` (from `@/lib/tabs`).
- Produces:
  - `type Route = { view: 'personal' } | { view: 'workspace'; workspaceId: string | null; tab: Tab }`
  - `function parse(pathname: string): Route`
  - `function toPath(route: Route): string`
  - `function useAppLocation(): { route: Route; navigate: (next: Route, opts?: { replace?: boolean }) => void }`

- [ ] **Step 1: 실패 테스트 작성 — `use-app-location.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { parse, toPath, type Route } from '@/lib/use-app-location';

describe('parse', () => {
  it('bare /app → workspace, null id, timeline', () => {
    expect(parse('/app')).toEqual({ view: 'workspace', workspaceId: null, tab: 'timeline' });
  });

  it('/app/ trailing slash → same default', () => {
    expect(parse('/app/')).toEqual({ view: 'workspace', workspaceId: null, tab: 'timeline' });
  });

  it('/app/personal → personal', () => {
    expect(parse('/app/personal')).toEqual({ view: 'personal' });
  });

  it('/app/:id with no tab → timeline', () => {
    expect(parse('/app/wsp_abc')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'timeline',
    });
  });

  it('/app/:id/:tab → that tab', () => {
    expect(parse('/app/wsp_abc/tasks')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'tasks',
    });
  });

  it('unknown tab → normalized to timeline', () => {
    expect(parse('/app/wsp_abc/bogus')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'timeline',
    });
  });

  it('connect is a valid tab segment', () => {
    expect(parse('/app/wsp_abc/connect')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'connect',
    });
  });
});

describe('toPath', () => {
  it('personal', () => {
    expect(toPath({ view: 'personal' })).toBe('/app/personal');
  });

  it('null workspaceId → bare /app', () => {
    expect(toPath({ view: 'workspace', workspaceId: null, tab: 'timeline' })).toBe('/app');
  });

  it('id + tab always explicit (even timeline)', () => {
    expect(toPath({ view: 'workspace', workspaceId: 'wsp_abc', tab: 'timeline' })).toBe(
      '/app/wsp_abc/timeline',
    );
  });
});

describe('round-trip parse ∘ toPath', () => {
  it('is identity for concrete routes', () => {
    const routes: Route[] = [
      { view: 'personal' },
      { view: 'workspace', workspaceId: 'wsp_abc', tab: 'tasks' },
      { view: 'workspace', workspaceId: 'wsp_xyz', tab: 'connect' },
    ];
    for (const r of routes) expect(parse(toPath(r))).toEqual(r);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test use-app-location`
Expected: FAIL — `@/lib/use-app-location` 모듈 없음.

- [ ] **Step 3: `use-app-location.ts` 구현**

```ts
import { useCallback, useEffect, useState } from 'react';

import { isTab, type Tab } from '@/lib/tabs';

/**
 * Path-based routing for the /app SPA. The URL owns which workspace is open and
 * which tab is active, so refresh and shared links restore state. Query flags
 * (?demo, ?task=) live on top and are preserved across navigation.
 *
 *   /app                     -> default (resolver redirects to the first workspace)
 *   /app/personal            -> personal memory view
 *   /app/:workspaceId/:tab   -> a workspace + tab (workspaceId is the stable wsp_ id)
 */
export type Route =
  | { view: 'personal' }
  | { view: 'workspace'; workspaceId: string | null; tab: Tab };

const BASE = '/app';

export function parse(pathname: string): Route {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const segs = rest.split('/').filter(Boolean); // [] | ['personal'] | [id] | [id, tab]
  if (segs[0] === 'personal') return { view: 'personal' };
  if (segs.length === 0) return { view: 'workspace', workspaceId: null, tab: 'timeline' };
  const workspaceId = decodeURIComponent(segs[0]);
  const tab: Tab = isTab(segs[1]) ? segs[1] : 'timeline';
  return { view: 'workspace', workspaceId, tab };
}

export function toPath(route: Route): string {
  if (route.view === 'personal') return `${BASE}/personal`;
  if (route.workspaceId == null) return BASE;
  return `${BASE}/${encodeURIComponent(route.workspaceId)}/${route.tab}`;
}

export function useAppLocation(): {
  route: Route;
  navigate: (next: Route, opts?: { replace?: boolean }) => void;
} {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    // Preserve the query string (?demo, ?task=) across path navigation.
    const url = toPath(next) + window.location.search;
    window.history[opts?.replace ? 'replaceState' : 'pushState'](null, '', url);
    setRoute(next);
  }, []);

  return { route, navigate };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test use-app-location`
Expected: PASS (11 tests).

- [ ] **Step 5: 커밋**

```bash
git add packages/web/src/lib/use-app-location.ts packages/web/src/lib/use-app-location.test.ts
git commit -m "feat(web): add useAppLocation — URL <-> route parse/serialize"
```

---

### Task 3: `WorkspaceCanvas`를 controlled 탭으로 전환

탭 상태의 소유권을 URL(부모)로 올린다. 이 태스크는 컴포넌트라 유닛 테스트가 아니라 typecheck를 게이트로 삼는다.

**Files:**
- Modify: `packages/web/src/components/canvas/WorkspaceCanvas.tsx`

**Interfaces:**
- Consumes: `type Tab`, `TABS` (from `@/lib/tabs`).
- Produces: `WorkspaceCanvas` props에 `tab: Tab`, `onTabChange: (t: Tab) => void` 추가. `workspaceId`/`meEmail`/`demo`는 유지.

- [ ] **Step 1: 로컬 탭 정의·상태 제거하고 `tabs.ts`에서 import**

`WorkspaceCanvas.tsx` 상단에서 로컬 `type Tab = ...`과 `const TABS: ... = [...]` 정의(파일 22–30행 부근)를 삭제하고, import에 추가한다:
```ts
import { TABS, type Tab } from '@/lib/tabs';
```

- [ ] **Step 2: `initialTab` 헬퍼 삭제**

`initialTab(demo)` 함수(파일 37–42행 부근, `?tab=`을 읽던 곳)를 통째로 삭제한다. 탭 초기값은 이제 부모(URL)가 준다.

- [ ] **Step 3: props를 controlled로 바꾸고 내부 상태 제거**

컴포넌트 시그니처를 다음으로 바꾼다:
```ts
export function WorkspaceCanvas({
  workspaceId,
  meEmail,
  demo,
  tab,
  onTabChange,
}: {
  workspaceId: string;
  meEmail: string;
  demo?: boolean;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}) {
  const example = MOCK_ENABLED || demo;
  // demo에는 Connect 탭이 없으므로(명령이 가짜 워크스페이스를 겨냥), URL로 강제
  // 진입하더라도 timeline으로 취급해 빈 화면을 막는다.
  const effectiveTab = demo && tab === 'connect' ? 'timeline' : tab;
```
그리고 기존 `const [tab, setTab] = useState<Tab>(() => initialTab(Boolean(demo)));` 줄을 삭제한다.

- [ ] **Step 4: 렌더에서 `tab`/`setTab`을 `effectiveTab`/`onTabChange`로 교체**

이 컴포넌트 안의 모든 사용처를 바꾼다:
- 비교 `tab === t.id`, `tab === 'connect'` → `effectiveTab === t.id`, `effectiveTab === 'connect'`
- 콘텐츠 스위치 `tab === 'timeline'` 등 6곳 → 모두 `effectiveTab === ...`
- 클릭 핸들러 `onClick={() => setTab(t.id)}` → `onClick={() => onTabChange(t.id)}`
- Connect 버튼 `onClick={() => setTab('connect')}` → `onClick={() => onTabChange('connect')}`
- `TimelineEmptyState`의 `onConnect={() => setTab('connect')}` → `onConnect={() => onTabChange('connect')}`

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: `App.tsx`가 아직 `tab`/`onTabChange`를 안 넘겨 **에러 발생**(다음 태스크에서 해소). 이 태스크만 보면 `WorkspaceCanvas.tsx` 자체 타입은 정합해야 한다 — 남는 유일한 에러는 App.tsx의 `WorkspaceCanvas` 호출부여야 한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/web/src/components/canvas/WorkspaceCanvas.tsx
git commit -m "refactor(web): make WorkspaceCanvas a controlled-tab component"
```

---

### Task 4: `App.tsx` 배선 + 리컨실리에이션

라우트를 App의 단일 상태원으로 삼고, 로드 후 URL을 실제 워크스페이스 목록에 맞춰 교정한다.

**Files:**
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `useAppLocation`, `type Route` (`@/lib/use-app-location`); `type Tab` (`@/lib/tabs`); Task 3의 `WorkspaceCanvas` props.

- [ ] **Step 1: import 추가, 상태 교체**

App.tsx 상단 import에 추가:
```ts
import { useAppLocation } from '@/lib/use-app-location';
```
`export default function App()` 안에서 `const [selectedId, setSelectedId] = useState<string | null>(null);` 와 `const [view, setView] = useState<'workspace' | 'personal'>('workspace');` 두 줄을 삭제하고 대신:
```ts
  const { route, navigate } = useAppLocation();
  const view = route.view;
  const currentTab = route.view === 'workspace' ? route.tab : 'timeline';
```

- [ ] **Step 2: `load()`에서 selectedId 초기화 제거**

`load()` 안의 성공 경로에서 `setSelectedId((cur) => cur ?? ws[0]?.workspaceId ?? null);` 줄을 삭제한다(리컨실 이펙트가 대신 처리). mock 폴백 경로의 `setSelectedId(MOCK_WORKSPACES[0]?.workspaceId ?? null);` 도 삭제한다.

- [ ] **Step 3: `selected` 계산을 라우트 기준으로**

`const selected = ...` 블록을 다음으로 바꾼다:
```ts
  const routeWorkspaceId = route.view === 'workspace' ? route.workspaceId : null;
  const selected =
    shownWorkspaces.find((w) => w.workspaceId === routeWorkspaceId) ??
    (demo ? (shownWorkspaces[0] ?? null) : null);
```

- [ ] **Step 4: 리컨실리에이션 이펙트 추가**

`useEffect(() => { void load(); }, [load]);` 아래에 추가:
```ts
  // 로드 후 URL을 실제 워크스페이스 목록에 맞춘다: 빈 /app 또는 목록에 없는
  // (나감/삭제/권한없음) id는 첫 워크스페이스로 replace. 에러 페이지는 없다.
  useEffect(() => {
    if (me === undefined) return; // 아직 로딩(Loading… 카드가 떠 있음)
    if (route.view !== 'workspace') return;
    if (shownWorkspaces.length === 0) return; // "No workspace selected" 빈 상태
    const exists =
      route.workspaceId != null &&
      shownWorkspaces.some((w) => w.workspaceId === route.workspaceId);
    if (!exists) {
      navigate(
        { view: 'workspace', workspaceId: shownWorkspaces[0].workspaceId, tab: route.tab },
        { replace: true },
      );
    }
  }, [me, shownWorkspaces, route, navigate]);
```

- [ ] **Step 5: Sidebar 콜백을 navigate로**

`<Sidebar ... />`의 콜백을 바꾼다:
```ts
        selectedId={selected?.workspaceId ?? null}
        view={view}
        onSelect={(id) =>
          navigate({ view: 'workspace', workspaceId: id, tab: currentTab })
        }
        onSelectPersonal={() => navigate({ view: 'personal' })}
```
(`onCreate`/`onOpenAccount`는 그대로.)

- [ ] **Step 6: WorkspaceCanvas에 tab/onTabChange 전달**

`WorkspaceView`가 `WorkspaceCanvas`를 감싸므로, `WorkspaceView`에 `tab`/`onTabChange`를 통과시킨다. `WorkspaceView` props 타입에 추가:
```ts
  tab: Tab;
  onTabChange: (t: Tab) => void;
```
(파일 상단에 `import { useAppLocation } ...` 옆으로 `import type { Tab } from '@/lib/tabs';` 추가.) `WorkspaceView` 내부의 `<WorkspaceCanvas ... />`에 `tab={tab}`·`onTabChange={onTabChange}` 추가. App 렌더의 `<WorkspaceView ... />`에 전달:
```ts
          <WorkspaceView
            me={account}
            demo={demo}
            workspace={selected}
            onOpenSettings={() => setSettingsOpen(true)}
            onChanged={onChanged}
            tab={currentTab}
            onTabChange={(t) =>
              navigate({ view: 'workspace', workspaceId: selected.workspaceId, tab: t })
            }
          />
```

- [ ] **Step 7: create/removed 경로를 navigate로**

`NewWorkspaceDialog`의 `onCreated`:
```ts
            onCreated={(id) => {
              void refreshWorkspaces();
              navigate({ view: 'workspace', workspaceId: id, tab: 'timeline' });
            }}
```
`onChanged`의 removed 분기:
```ts
  const onChanged = async (opts?: { removed?: boolean }) => {
    const ws = await refreshWorkspaces();
    if (opts?.removed) {
      navigate(
        { view: 'workspace', workspaceId: ws[0]?.workspaceId ?? null, tab: 'timeline' },
        { replace: true },
      );
    }
  };
```

- [ ] **Step 8: 전체 typecheck + lint + 테스트**

Run: `pnpm check && pnpm test`
Expected: PASS. 미사용 import(`useState` 등)가 남았으면 정리.

- [ ] **Step 9: 커밋**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): drive workspace+tab from the URL via useAppLocation"
```

---

### Task 5: 통합 검증 + 핸드오프

**Files:** (없음 — 검증·기록만)

- [ ] **Step 1: 빌드 확인**

Run(`packages/web`): `pnpm build`
Expected: 타입체크 통과 후 `dist/`가 생성된다.

- [ ] **Step 2: 실제 브라우저 구동 검증(verify 스킬)**

`verify` 스킬로 게이트웨이+웹을 띄우고 다음을 눈으로 확인한다:
1. 워크스페이스 A의 Tasks 탭 선택 → URL이 `/app/<wsp_A>/tasks` 로 바뀐다.
2. **새로고침** → 같은 워크스페이스+Tasks 탭이 복원된다.
3. 워크스페이스 B로 전환 → `/app/<wsp_B>/timeline`. **뒤로가기** → A/Tasks로 돌아온다.
4. `/app/personal` 직접 진입 → 개인 메모리 뷰.
5. 존재하지 않는 `/app/wsp_zzz/tasks` 진입 → 첫 워크스페이스로 교정(에러 없음), URL이 replace 된다.

- [ ] **Step 3: 루트 통합 체크**

Run(레포 루트): `pnpm -r check`
Expected: 두 패키지 모두 typecheck+lint+test 통과(web의 vitest 포함).

- [ ] **Step 4: memorize에 진행 기록 / 핸드오프**

```bash
memorize task handoff --task task_mr53i62i_q8jk2nbt --summary "SPA 경로 라우팅 구현 완료 — 브랜치 feat/spa-url-routing. useAppLocation 훅(parse/toPath 유닛테스트), WorkspaceCanvas controlled 전환, App 리컨실리에이션. /app/:wsp_/:tab + /app/personal, 새로고침·공유·뒤로가기 복원 확인."
```

- [ ] **Step 5: 마무리**

`superpowers:finishing-a-development-branch` 스킬로 PR 생성/머지 옵션을 정한다.

---

## 자기 검토 메모

- **스펙 커버리지**: URL 구조(Task 2 parse/toPath) · 훅(Task 2) · 리컨실리에이션(Task 4 Step 4) · controlled 탭(Task 3) · 히스토리 시맨틱스(Task 2 navigate + Task 4의 replace 사용처) · 테스트(Task 1·2) · `?tab=` 제거(Task 3 Step 2) — 모두 태스크 존재.
- **데모 엣지**: `?tab=connect` 데모 예외는 `effectiveTab` 가드(Task 3 Step 3)로 이관.
- **타입 일관성**: `Route`/`Tab`/`parse`/`toPath`/`navigate` 시그니처가 Task 2 정의와 Task 3·4 사용처에서 동일.
