# Tasks 워크플로우 타임라인 (Gantt + 선후행 화살표) — 설계

> 상태: DRAFT / 설계 승인됨 (2026-07-04, 브레인스토밍 세션). 구현 착수 전.
> task: `task_mr53ywjf_hfkxfgqy` (Tasks 선후행+작업기간 워크플로우 타임라인 뷰, 좌우 DAG).
> 권위: Hub SoT(H060 read surface) + PROTOCOL.md 와이어 계약. 충돌 시 SoT/PROTOCOL이 이긴다.
> 2-plane 경계: 이 작업은 **읽기 표면(replica→gateway→web)** 안에서만 논다.
> relay 무변경, gateway 무변경(통과), 도메인/이벤트 스키마 무변경.

## 0. 배경과 동기

### 0.1 무엇을

Tasks 탭은 지금 두 뷰가 있다 — Board(status별), List(source project별). 둘 다
**시간·의존 구조가 안 보인다.** 요청: task의 **선후행(dependsOn)** 과 **작업기간**을
좌우 시간축 위에 얹은 세 번째 뷰. 각 task는 시간축 위의 세그먼트 막대(대기|작업)이고,
dependsOn은 선행 막대에서 후행 막대로 가는 화살표.

### 0.2 시각 모델 (확정)

**Gantt + 선후행 화살표 (time-first)**: 가로축 = 실제 시간. 세로 = task당 1행.
세그먼트 막대 = 대기(░, todo) + 작업(▓, in_progress). dependsOn = 막대 사이 화살표.

대안 2개(topology-first 순수 DAG / status 스윔레인)는 기각 — 제목의 "작업기간 + 타임라인"에
가장 충실한 게 time-first이고, 유저가 명시 선택.

### 0.3 핵심 제약: 데이터 공백

이 뷰가 필요로 하는 두 입력이 **지금 읽기 표면에 없다**:

1. **선후행**: memorize 도메인 `Task.dependsOn`은 존재하지만 replica `TaskBoardItem`이
   통째로 버린다.
2. **작업기간**: 도메인에 start/due 필드가 없다(`web/src/lib/domain.ts` 주석 "No
   due/start dates"). 읽기 표면엔 `at`(=마지막 상태전이=`updatedAt`) 하나뿐.

따라서 이 task는 **프론트 뷰 하나가 아니라, replica→gateway→web 데이터 배선 +
신규 뷰**다 — 최근 타임라인 페이지네이션(PR #61)과 같은 3계층 수직 슬라이스.

## 1. 스코프 경계

### 1.1 In scope

- replica `readTasks`: `dependsOn` + `createdAt` 전달 + 이벤트 로그에서 `startedAt` 유도.
- web: `TaskEntry`에 신규 필드, TasksTab에 `timeline` 뷰 신설, 신규 `TasksTimeline.tsx`.
- MOCK_TASKS 확장(dependsOn + 타이밍) — 데모/dev gantt가 실제 엣지·세그먼트 렌더.
- 단위 테스트(replica 유도 로직 + web 순수 헬퍼).

### 1.2 Out of scope (스코프 컷 아님 — 명시적 유보)

- **다중 작업 세그먼트**: blocked로 중단→재개 시 작업 세그먼트가 1개(첫 in_progress→끝)로
  합쳐진다. 다구간 표시는 v1 유보.
- **dependsOn UI 편집**: 읽기 전용 유지(캔버스 나머지와 동일, §5 phase 2 authoring 대기).
- **시간축 줌/팬**: v1은 fit-to-span만.
- **timeline 서브뷰의 URL 상태**: 별도 라우팅 task(`task_mr53i62i`) 소관.
- **gateway 변경**: 없음(§2.3 참조).

## 2. 와이어 계약 (읽기 표면 필드 추가)

`TaskBoardItem`(replica `src/tasks.ts`) → gateway 통과 → `TaskEntry`(web
`src/lib/domain.ts`)에 아래를 추가. PROTOCOL.md의 tasks 응답 항목 스키마도 동일하게 갱신.

### 2.1 신규 필드

| 필드 | 타입 | 출처 | 비고 |
|---|---|---|---|
| `dependsOn` | `string[]` | 프로젝션 `Task.dependsOn` | 비면 와이어에서 생략 |
| `createdAt` | `string` (ISO-8601) | 프로젝션 `Task.createdAt` | 대기 세그먼트 시작 |
| `startedAt` | `string?` (ISO-8601) | 이벤트 로그 유도 | status→`in_progress` **첫** 이벤트 시각. 미경유면 생략 |

기존 `at`(=`updatedAt`=마지막 전이)은 그대로 두고 막대 끝 계산에 재사용.

### 2.2 세그먼트 막대 계산 (클라이언트)

`{createdAt, startedAt?, at, status}`로 web에서 계산. terminal = `status ∈ {done,
cancelled}`.

- **대기(░)**: `createdAt → (startedAt ?? at ?? now)` — 항상 존재.
- **작업(▓)**: `startedAt → (terminal ? at : now)` — `startedAt` 있을 때만.
- **미시작 + terminal**(todo→done 직행 / todo에서 취소): 대기 막대(`createdAt→at`)
  오른쪽 끝에 **done/cancel 마커 ◇**. (별도 마일스톤 대신 대기 막대를 항상 그려
  화살표 규칙을 균일하게 유지.)
- **미시작 + 열림**(todo): `createdAt→now` 대기 막대만.

### 2.3 gateway: 무변경

`handleWorkspaceTasks → forwardReplicaRead`의 `labelMembers`가 각 item을 `{...row}`로
스프레드하므로 신규 필드는 손 안 대고 통과한다. gateway 코드·테스트 변경 없음.
(단 §5의 e2e가 신규 필드로도 깨지지 않는지 확인.)

## 3. replica 변경 (`packages/replica/src/tasks.ts`)

`readTasks`는 이미 프로젝션(`listTasks`)과 이벤트 로그(`readEvents`)를 둘 다 읽는다.

### 3.1 `dependsOn` + `createdAt`

`toBoardItem`에서 프로젝션 `Task`의 `dependsOn`(비면 생략), `createdAt`을 그대로 실음.
이벤트 채굴 불필요 — 프로젝션에 이미 있음.

### 3.2 `startedAt` 유도

기존 이벤트 스캔 루프(`lastTaskEvent` 채우는 곳)에 얹어, task별로 **status를
`in_progress`로 만든 첫 이벤트**의 시각을 기록한다. `task.updated` payload가 `status`를
싣고 각 이벤트에 시각이 있으므로 유도 가능(확인함). 이미 기록된 task는 갱신하지 않음(첫 값 고정).

```
firstInProgressAt: Map<taskId, isoString>
for event of events (insertion order):
  if event sets status == 'in_progress' and !firstInProgressAt.has(taskId):
    firstInProgressAt.set(taskId, event.at)
```

`toBoardItem(storeId, task, lastEvent, handoffs, startedAt?)` 시그니처에 `startedAt`
추가, 있으면 실음.

### 3.3 접근 선택: 컴팩트 3필드 vs 전체 전이 이력

타이밍을 컴팩트 3필드(`createdAt` / `startedAt` / `at`)로 싣는다. 전체 전이 이력
(`{status, at}[]`)을 싣는 대안보다 와이어가 작고, 세그먼트 막대(대기 1 + 작업 1)엔 충분.
비용: 다구간(blocked 중단) 표현 불가 — §1.2에서 유보 처리.

## 4. web 뷰 (`packages/web/src/components/canvas/`)

### 4.1 TasksTab 통합

- 뷰 토글에 세 번째 추가: `'board' | 'list' | 'timeline'`.
- 기존 member/priority 필터 + 상세 peek 패널 **재사용** — timeline 막대 클릭 시 같은
  peek 오픈(`selectedId` 공유).
- 신규 컴포넌트 `TasksTimeline.tsx`로 렌더 로직 분리(TasksTab이 이미 ~460줄).

### 4.2 `TasksTimeline.tsx`

입력: 필터된 `TaskEntry[]`, `meEmail`, `onSelect(id)`.

- **시간 도메인**: `[min(createdAt), max(막대 끝 or now)]`. 우리 워크스페이스 task가 다
  같은 1~2일 안이라 **시간(hour) 단위 눈금**까지 대응 — span 크기로 tick granularity
  자동 선택(분/시/일). 도메인 폭 0(전부 같은 순간)일 때 최소 폭 보정.
- **행 순서**: dependsOn **위상정렬**(선행이 위, 화살표가 아래로 흐름), 동률은
  `createdAt`. 사이클 가드(dependsOn은 비순환이어야 하나 방어적으로).
- **렌더(SVG)**: X=시간(손수 짠 선형 스케일 `time→px`), task당 1행. 세그먼트 rect 2개
  (░ 대기 / ▓ 작업), 미시작+terminal은 대기 rect + ◇ 마커. status 색상 코딩
  (done/blocked/cancelled/in_progress/todo). 테마 대응(기존 tailwind CSS 변수 / `currentColor`).
- **차트 라이브러리 없음**: web 패키지에 차트 dep 없음(tailwind+radix+lucide) → 손수 짠
  SVG. 자체완결·테마대응 ethos에 부합.

### 4.3 선후행 화살표 앵커 규칙 (핵심)

들어오는 dependsOn 화살표(선행→이 task)의 **도착 지점**을 이 task의 "작업이 시작될(수
있는) 지점"에 붙인다:

- **도착(후행) 앵커 x** = `startedAt ?? createdAt`
  - 미시작(todo): 대기(░) 막대 **왼쪽 끝**(`createdAt`).
  - 작업 시작됨: 대기|작업 세그먼트 **경계 = 작업(▓) 막대 왼쪽 끝**(`startedAt`).
  - `startedAt`이 채워지면 앵커가 대기막대 좌단 → 작업막대 좌단으로 자연 이동.
- **출발(선행) 앵커 x** = 선행 막대 끝(`terminal ? at : now` = 그 task의 done/현재 지점).
- **가시성**: 양 끝이 **모두 필터된(보이는) 집합** 안일 때만 엣지를 그린다.

근거: 선후행으로 쪼갠 task는 보통 **동시에 생성**되어 `createdAt`을 공유하므로, 화살표가
후행의 대기막대 좌단에서 출발했다가 후행이 착수하면 작업막대 좌단으로 옮겨가는 동작이
자연스럽게 읽힌다("이 의존 때문에 실제 작업 착수가 이 지점에 걸린다").

## 5. 테스트

- **replica** (`packages/replica`): `readTasks`가 seeded 이벤트 로그
  (todo→in_progress→done)에서 `dependsOn`·`createdAt`·`startedAt`을 정확히 유도하는지,
  그리고 (a) 미시작+terminal(startedAt 없음), (b) 진행중(끝 열림) 케이스 단위 테스트.
- **web** (`packages/web`): `TasksTimeline` **순수 헬퍼** vitest 단위 테스트 —
  시간도메인 계산 / 위상정렬(동률·사이클) / 세그먼트 계산(4케이스) / `time→px` 스케일.
  SVG 좌표 수학은 DOM 없이 검증.
- **gateway**: 신규 테스트 불필요(통과). 기존 tasks e2e가 신규 필드로도 green 유지 확인.
- 루트 `pnpm -r check`(typecheck + lint + test) green.
- **UI 실동작**(스크롤·화살표 렌더)은 인증된 라이브 스택이 필요 — 로컬 검증 인프라가
  없으면 페이지네이션 때와 같은 한계(별도 확인).

## 6. 파일 영향 요약

| 파일 | 변경 |
|---|---|
| `packages/replica/src/tasks.ts` | `TaskBoardItem`에 dependsOn/createdAt/startedAt, startedAt 유도 |
| `packages/replica/test/*` | readTasks 유도 단위 테스트 |
| `PROTOCOL.md` (또는 `docs/protocol/*`) | tasks 응답 항목 스키마에 신규 필드 |
| `packages/web/src/lib/domain.ts` | `TaskEntry`에 신규 필드 |
| `packages/web/src/components/canvas/TasksTab.tsx` | timeline 뷰 토글 + 배선 |
| `packages/web/src/components/canvas/TasksTimeline.tsx` | 신규 gantt 컴포넌트 |
| `packages/web/src/lib/mock.ts` | MOCK_TASKS에 dependsOn + 타이밍 |
| `packages/web/test/*` | TasksTimeline 순수 헬퍼 단위 테스트 |

## 7. 조율 노트

병렬 세션이 task 상태머신을 손보는 중(`start`→in_progress 전이 신설, in_progress→done
직행 허용 — `task_mr53pkwo`). 내 `startedAt` 유도는 **로그에 있는 in_progress 전이를
읽을 뿐**이라 그 변경에 견고하다(하드 의존 없음). 오히려 `start` 도입으로 in_progress
신호가 더 확실히 남아 세그먼트 막대가 잘 채워진다.
