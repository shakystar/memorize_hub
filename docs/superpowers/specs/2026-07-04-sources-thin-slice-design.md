# Sources 페이지 — 얇은 슬라이스 (아웃링크) 설계

> 상위 task: memorize `Sources 페이지 + 신규 읽기 패키지`(L 규모)를 레이어별로
> 분해한 첫 슬라이스. 이 문서는 그 첫 슬라이스의 설계만 확정한다.
> 후속(백링크·원본 열람·영속화)은 아래 "미룸(defer)" 절 + 별도 memorize task.

## Goal

memorize 클라이언트가 relay로 올린 이벤트 로그만으로 `기억 -> 관측 ->
파일/트랜스크립트 경로` 참조 사슬을 Hub 웹에서 조회하고, 참조가 해소되지 않는
기억을 "반쪽(unverified)"으로 표시한다. 파일 내용 업로드는 없다 — 경로 문자열과
관측 메타데이터만 렌더한다.

## Scope (이번 슬라이스)

- 아웃링크 방향만: `기억 -> 그 기억의 출처들`.
- Hub 단독 — relay 무변경, memorize(client) 무변경.
- 투영은 on-demand, in-memory(새 테이블/der_ 영속화 없음).

## Non-goals (미룸, scope cut 아님)

- **원본 파일/트랜스크립트 내용 열람** — der_ 사이드카 + memorize client 업로드
  경로 필요. lazy on-request. 별도 설계.
- **백링크 패널**(파일 -> 그 파일을 근거로 삼은 기억들) — 이번엔 티저 카운트만.
- **투영 der_ 영속화** — on-demand가 무거워지면.
- **`packages/sources` 독립 패키지 분리** — 공유 ingest 층을 base로 승격하는
  시점에. 지금은 `packages/replica` 안에 lane으로 둔다.

## 아키텍처 / 레이어

- 새 relay 소비자를 만들지 않는다. `packages/replica/src/read-lane.ts`가 이미
  workspace union을 결정론적 로컬 lane(`serverStoreId`)으로 pull하고, 그 위에서
  `timeline` / `tasks`를 투영한다. `sources`는 **같은 lane 위의 동급 투영**이다.
- 레이어 경계를 처음부터 지킨다: **공유 ingest(pull+parse) 층 -> 투영 lane들**.
  `timeline.ts` / `tasks.ts` 옆에 `sources.ts`를 peer로 신설. 커지면 ingest를
  base로 승격만 하고, 도메인별 패키지 분리는 하지 않는다(중복 relay pull 회피).

## 데이터 모델

원천 필드는 memorize의 `observation.captured` / `memory.consolidated` payload에
이미 존재하며 relay는 append-only라 로컬 GC 후에도 relay엔 남는다(사슬 복원 가능).

### 관측 (`observation.captured`)

`id`, `createdAt`, `projectId`, `sessionId?`, `toolName?`(Write/Edit/Bash),
`signal`, `summary?`(rule 한 줄: 파일경로·명령 head), `filePath?`(un-clipped,
write류만), `transcriptPath?`, 그리고 provenance 메타(`agentSessionId?`,
`conversationId?`, `generationId?`, `toolUseId?` — 이번 UI엔 미노출).

### 기억 (`memory.consolidated`)

`id`, `kind`, `text`, `salience`, `createdAt`, `sourceObservationIds[]`,
`importSource?`.

### 상태 판정 (파생)

- `sourceObservationIds` 중 **하나라도 미해소** -> `unverified`(반쪽).
- 전부 해소 -> `verified` + 각 관측 경로 사슬 부착.
- **빈 배열** -> `rootless`(출처 없음). 반쪽과 별개 카테고리(웹 저작·import 기억을
  "깨진 것"으로 보이게 하지 않는다).
- `resolvedCount` / `totalCount`도 낸다("3개 중 2개 해소").

## Sources 투영 (`packages/replica/src/sources.ts`)

lane 이벤트를 한 번 순회:

1. `observation.captured` -> `Map<obsId, ObservationDetail>`.
2. `memory.consolidated` -> 각 기억의 `sourceObservationIds`를 위 맵으로 해소,
   상태 판정, 사슬 부착.

같은 pass에서 역인덱스(`Map<filePath, memoryId[]>`)도 만든다 — 백링크 티저
카운트에 쓰고, 후속 백링크 패널이 그대로 재사용한다(데이터 비용 ~0).

출력:
`{ memoryId, kind, text, salience, createdAt, status, resolvedCount, totalCount,
chain: [{ obsId, resolved, toolName?, signal, summary?, filePath?,
transcriptPath?, createdAt, citedByCount }] }[]`.

## 읽기 엔드포인트 + 게이트웨이

- replica: `GET /v1/workspaces/:id/sources` 신설(`SOURCES_ROUTE`), timeline/tasks
  라우트 형제. lane 보장 후 `sources.ts` 투영 반환.
- gateway: `timeline.ts` 프록시 패턴을 복제한 `sources.ts` passthrough. 멤버
  라벨링의 top-level 필드 보존 방식 그대로. 새 인가 없음 — 기존 store ACL 사용.

## 웹 SourcesTab

**상태: UI 형태는 미확정(사용자 피드백 루프 진행 중). 데이터 계약·투영·엔드포인트는
위 절대로 확정.** 디자인 이터레이션은 아래 멘털 모델과 결정 로그 위에서 계속한다.

### 멘털 모델 (확정)

데이터 = **3층 희소 레이어드 DAG**: `파일/locator층 -> 관측층 -> 기억층`.
- 간선은 인접 층 사이에만(층 건너뛰기 없음). 층 사이는 many-to-many(팬인/팬아웃).
- DNN 다이어그램과 같은 흐름이되 fully-connected가 아니라 희소(기억당 관측 2~5,
  관측당 파일 보통 1).
- 반쪽 = 기억에서 나간 간선이 허공(관측 유실). rootless = 나가는 간선 없는 노드.

**렌더 원칙: 그래프를 그래프로 그리지 않는다.** 앵커별 절단면(트리/리스트 조각)으로
자른다 — 기억 앵커 절단면(기억 -> 출처들) + 파일 앵커 절단면(파일 -> 기억들, 후속
백링크 패널). 두 절단면 합이 DAG 전체를 덮는다.

### locator 축 (확정 — 참조 종류 확장 대비)

출처 행은 `filePath` 하드코딩이 아니라 locator로 렌더:
`{ kind: file | transcript | command | url | memory, value }`.
현재 와이어엔 file/transcript/command만 존재. url(외부 GitHub 등)/memory(기억 간
참조)는 memorize 관측 스키마에 아직 없음 — 스키마가 자라도 UI는 행 종류만 는다.

### 유력안 A — 기억 카드 피드 (플랫, 다음 목업 대상)

카드 = 기억(kind 점 + 본문 + status 뱃지) + 그 아래 출처 locator 리스트.
각 출처 행 오른쪽 `↩N` = 그 locator를 인용한 다른 기억 수(백링크가 티저 카운트가
아니라 **인라인 상주** — Request/Response 비대칭 해소). 드릴다운·컬럼 없음.

### 기각/제약 (결정 로그)

- **밀러 3컬럼 단독 기각** — 목업까지 갔으나 아웃링크(Request)만 공간을 점유해
  백링크(Response)가 티저로 쪼그라드는 비대칭. 반응형 약점도 확인.
- **force-directed 그래프뷰 금지** — 노드 수백이면 털뭉치, 유틸 낮음.
- **Finder를 디자인 SoT로 삼지 않음** — 권위가 아니라 문제-해법 적합성 기준.
  Finder는 무한깊이 균질 트리용, 우리는 고정깊이 이질 DAG. 단 출처 축(경로)은
  진짜 트리라 후속 백링크 패널의 디렉터리 그룹핑 관용구로는 채용.
- 좁은 폭 폴백 필수(어떤 형태든).

### 목업

밀러 컬럼 버전(기각된 1차): https://claude.ai/code/artifact/196394f2-fce5-4440-833f-1a539b5db017
— 다음 이터레이션은 같은 artifact URL에 안 A로 재배포(Artifact 도구 `url` 파라미터).

### 열린 질문 (다음 디자인 세션)

- 카드 밀도(기억 본문 1줄 vs 2줄, salience 노출 여부).
- 끊긴 고리 톤 — 경고(빨강)냐 차분(회색 점선)이냐: 반쪽이 흔한 정상 상태인지에 달림.
- rootless 노출 기본값(항상 표시 vs 필터로만).
- 파일 앵커 테이블(안 B)을 이번 슬라이스에 겸치할지, 백링크 패널로 온전히 미룰지.

## 테스트 (TDD)

- `packages/replica/tests/unit/sources.test.ts`: verified / 반쪽 / rootless 세
  케이스, 부분 미해소가 반쪽 되는지, 빈 배열이 rootless인지, 역인덱스 카운트.
- gateway 프록시 passthrough 단위 테스트(timeline 것 복제).
- 웹은 투영 결과 렌더 최소 확인 + 좁은 폭 아코디언 폴백.

## 결정 로그 (이 세션에서 확정)

- **Q1 = A**: 신규 패키지가 아니라 `packages/replica` 안 sources lane. 커지면
  레이어별 분리(공유 ingest base 승격), 도메인별 패키지 분리 아님.
- **Q2 = A**: 하나라도 미해소면 반쪽, 빈 배열은 rootless(별개).
- **Q3**: 원본 파일 내용 업로드는 defer(der_ + client 업로드로 후속).
- **디자인**: Finder 밀러 3컬럼(아웃링크) 확정. 백링크는 이번에 티저 카운트만,
  풀 패널은 다음. 그래프뷰 금지. 반응형 아코디언 폴백 필수.
