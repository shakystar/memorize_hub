# SPA URL 라우팅: 워크스페이스 + 탭 상태를 URL에 반영

- 상태: 설계 확정 (2026-07-04)
- 태스크: `task_mr53i62i_q8jk2nbt` (high)
- 대상: `packages/web` (게이트웨이 웹 SPA, `/app`)
- 브랜치: `feat/spa-url-routing`

## 문제

게이트웨이 웹 SPA는 워크스페이스 선택과 활성 탭을 React `useState`로만 들고
있다. URL은 항상 `/app`에 고정되어 있어서, 새로고침하거나 링크를 공유하면
있던 자리가 아니라 기본 워크스페이스/탭으로 되돌아간다.

현재 상태 모델:
- `App.tsx` — `view: 'workspace' | 'personal'`, `selectedId: string | null`
  (workspaceId), 그리고 모달 상태(`newOpen`/`settingsOpen`/`accountOpen`).
- `WorkspaceCanvas.tsx` — `tab` (`timeline`/`tasks`/`talk`/`decisions`/
  `sources`/`connect`)를 내부 `useState`로 보유. 마운트 시 `?tab=` 쿼리를
  한 번 읽지만(`initialTab`), 탭 클릭은 URL에 되쓰지 않는다.

## 범위

- **범위 안**: 워크스페이스 선택 + 활성 탭 + personal 뷰를 URL에 반영하고
  새로고침·공유 링크에서 복원.
- **범위 밖(잘라낸 게 아니라 연기)**:
  - 탭 내부 딥스테이트 — `?task=`(선택된 태스크, `TasksTab`), 타임라인
    스크롤 위치/날짜(`mr53no79`). 쿼리/로컬 상태로 유지.
  - localStorage "마지막 방문" 지속 — URL 자체가 그 역할을 하므로 불필요.
  - 예쁜 슬러그 — 안정적인 `wsp_` id를 그대로 쓴다(아래 근거).

## URL 구조 (경로 기반)

경로가 워크스페이스 + 탭을 소유한다. 기존 쿼리 플래그(`?demo`, `?task=`)는
그대로 위에 얹혀 공존한다.

| URL | 상태 |
|---|---|
| `/app` | 기본값 → 리졸버가 첫 워크스페이스로 리다이렉트 |
| `/app/personal` | 개인 메모리 뷰 |
| `/app/:workspaceId/:tab` | 워크스페이스 + 탭 (예: `/app/wsp_abc/tasks`) |

설계 근거:
- **`:workspaceId`는 서버가 발급한 안정적 `wsp_` id**(슬러그 아님). 이름
  변경(`mr53c2av` 표시명 작업)돼도 공유 링크가 깨지지 않는다. `personal`은
  예약 세그먼트인데, `wsp_` 접두사 id는 문자열 `personal`과 절대 같을 수
  없으므로 충돌하지 않는다.
- **탭은 timeline이어도 항상 명시적으로 직렬화**한다. URL이 탭 상태를 문자
  그대로 반영한다는 태스크 의도를 지키기 위함. 파싱은 관대하게: 빈 `/app/:id`
  도 받아들여 `timeline`으로 해석한다.
- `?tab=` 쿼리 지원은 **제거**한다. 내부에서만 쓰였고(레포 전체에서 외부
  링크·문서 참조 없음) 경로 세그먼트로 대체된다. `?task=`(탭 내부 딥링크)와
  `?demo`(익명 데모 모드)는 쿼리로 남는다.

## 라우트 모델과 훅

```ts
type Route =
  | { view: 'personal' }
  | { view: 'workspace'; workspaceId: string | null; tab: Tab };
```

`workspaceId: null` = 빈 `/app`(아직 워크스페이스가 해석되지 않았거나 하나도
없는 상태).

새 모듈 `packages/web/src/lib/use-app-location.ts`:

- `parse(pathname): Route` — 순수 함수. `/app` 접두사를 벗기고 세그먼트로
  분기:
  - `[]` 또는 `['']` → `{ view: 'workspace', workspaceId: null, tab: 'timeline' }`
  - `['personal']` → `{ view: 'personal' }`
  - `[id]` → `{ view: 'workspace', workspaceId: id, tab: 'timeline' }`
  - `[id, tab]` → 탭 검증; 모르는 탭이면 `timeline`으로 정규화
- `toPath(route): string` — 순수 함수(pathname만 반환).
  - `personal` → `/app/personal`
  - workspace + `null` id → `/app`
  - workspace + id → `/app/${id}/${tab}` (탭 항상 포함)
- `useAppLocation()` — 훅.
  - `parse(location.pathname)`로 초기화한 `route` state.
  - `popstate` 리스너로 뒤로/앞으로 가기 때 재파싱.
  - `navigate(route, { replace? })` — `history.pushState`/`replaceState`로
    경로를 쓰고 `route` state를 갱신한다. **현재 `location.search`를
    보존**한다(`?demo`/`?task=`가 내비게이션을 넘어 살아남도록).

`Tab` 유니온과 탭 메타데이터(`TABS`)·검증(`isTab`)은 작은 새 모듈
`packages/web/src/lib/tabs.ts`로 분리해 `WorkspaceCanvas`와
`use-app-location` 양쪽에서 import 한다(순환 import 방지).

## 리컨실리에이션 (새로고침 복원 + 잘못된 값 폴백)

파싱은 URL 문자열만 안다. 신원(identity)과 워크스페이스 목록이 로드된 뒤,
`App`의 이펙트가 파싱된 라우트를 실제와 대조해 교정한다:

- **빈 `/app`** (`workspaceId: null`) → `workspaces[0]`을 골라 그 URL로
  `replaceState`. 워크스페이스가 하나도 없으면 기존 "No workspace selected"
  빈 상태를 그대로 렌더(리다이렉트 없음).
- **목록에 없는 `workspaceId`** (나감/삭제/권한 없음) → `workspaces[0]`(없으면
  빈 상태)로 폴백하고 올바른 URL로 `replaceState`. **에러 페이지 없음** —
  워크스페이스가 사라졌을 수 있는 정상 경로다.
- **잘못된 탭** → 이미 `parse` 단계에서 `timeline`으로 정규화됨.
- **`personal` 뷰**는 항상 유효(계정 스코프).
- **데모 모드**(`?demo`)는 워크스페이스가 MOCK 집합에서 오며 동일한 규칙으로
  MOCK 목록에 대조해 리컨실.

정규화로 인한 URL 교정은 항상 `replaceState`를 써서 히스토리를 오염시키지
않는다.

## 컴포넌트 배선

1. **새 파일** `packages/web/src/lib/tabs.ts` — `Tab` 유니온, `TABS` 메타,
   `isTab(x): x is Tab`.
2. **새 파일** `packages/web/src/lib/use-app-location.ts` — `Route`, `parse`,
   `toPath`, `useAppLocation`.
3. **`App.tsx`**:
   - `selectedId` + `view` `useState`를 `useAppLocation()`으로 교체.
   - `route`가 뷰 + 선택 워크스페이스를 구동. 사이드바 select/personal/create/
     removed 콜백이 `navigate`를 호출.
   - 로드 후 리컨실리에이션 이펙트(빈/잘못된 라우트를 `navigate(..., {replace})`
     로 교정).
   - 모달 상태(`newOpen`/`settingsOpen`/`accountOpen`)는 로컬 `useState`로
     유지 — URL에 넣지 않음(공유·새로고침 대상이 아닌 순간 상태).
4. **`WorkspaceCanvas.tsx`**:
   - `tab: Tab` + `onTabChange: (t: Tab) => void` props를 받는 **controlled**
     컴포넌트로 전환. 내부 `useState<Tab>` 및 `initialTab`(그리고 그 안의
     `?tab=` 읽기) 제거.
   - `Tab` 타입/`TABS`는 `lib/tabs.ts`에서 import.
   - `useLiveFeed` 훅들은 계속 `workspaceId`로 키잉되므로 데이터 동작은 불변.
     워크스페이스 전환 시 탭 유지(라우트의 탭이 바뀌지 않음) — 현행 동작과
     일치.

## 히스토리 시맨틱스

- **사용자 조작**(워크스페이스 전환, 탭 클릭, personal 열기) → `pushState`.
  브라우저 뒤로/앞으로 가기가 워크스페이스+탭 히스토리를 따라간다.
- **리컨실리에이션/정규화**(빈→해석, 잘못됨→폴백) → `replaceState`.
  쓰레기 히스토리 항목을 만들지 않는다.
- **`popstate`** → 훅이 재파싱하고 다시 렌더.

## 테스트

`vitest` 유닛 테스트로 순수 `parse`/`toPath` 왕복을 검증한다. 이것이 위험
표면의 전부다(파싱/직렬화는 순수하고 DOM 비의존):

- 빈 `/app` → `{ workspace, null, timeline }`, `toPath` → `/app`
- `/app/personal` 왕복
- `/app/wsp_abc` (id만) → 탭 `timeline`
- `/app/wsp_abc/tasks` 왕복
- `/app/wsp_abc/bogus` → 탭 `timeline`으로 정규화
- `wsp_` id + 쿼리 문자열이 `navigate`에서 보존되는지

## 정직한 한계

- `parse`는 첫 세그먼트가 `personal`이 아니면 워크스페이스 id로 간주한다.
  `wsp_` 접두사 id는 `personal`과 충돌하지 않으므로 안전하지만, 향후 다른
  예약 최상위 세그먼트를 추가하려면 이 예약어 집합을 함께 늘려야 한다.
- 페이지 진입 시 잘못된 workspaceId에 대한 폴백은 워크스페이스 목록이 로드된
  뒤에야 일어난다. 로드 전 짧은 순간에는 "Loading…" 카드가 이미 뜨므로
  사용자에게 잘못된 상태가 노출되지 않는다.
