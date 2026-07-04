# `connect` 동사 신설 — clone/remote 통합 + 웹 카피 정리

- **Task**: `task_mr53c1te_uf3n740m` (memorize_hub, high)
- **Date**: 2026-07-04
- **Repos**: `../memorize` (CLI 본체), `memorize_hub` (웹 카피)
- **Branches**: CLI `feat/connect-verb`(../memorize), 웹 `feat/connect-verb`(memorize_hub)

## 문제

온보딩 카피가 두 갈래를 사용자에게 떠넘긴다: 새 머신이면 `memorize clone <url>`,
기존 로컬 프로젝트면 `memorize remote <url>`. 사용자는 "내 상황이 어느 쪽인지"를
스스로 판별해 골라야 하고, 웹 Connect 탭과 `/clone/:id` 랜딩은 두 커맨드 블록을
나란히 노출해 화면이 무겁다. git은 이 구분을 사용자에게 지우지 않는다 —
디렉터리 상태를 보고 도구가 정한다.

## 목표

단일 동사 `memorize connect <hub-url>`가 디렉터리 상태를 보고 자동 분기한다.
기존 `clone`/`remote`는 하위호환 별칭으로 그대로 살린다. 웹/게이트웨이 온보딩
카피는 `connect` 한 줄로 통일한다.

### 비목표

- clone/remote 별칭 제거·deprecation 경고 (별칭은 조용히 유지, 카피에서만 사라짐)
- 설치 자동화(`npm i -g`)를 CLI가 대신 하기 — 설치·환경변수·훅 배선은
  기존 `guides/AI_SETUP.md`에 위임한다 (아래 웹 카피 참조)

## A. CLI (`../memorize`) — 먼저, PR #1

`clone`(project.ts:173)과 `remote`(project.ts:227)는 이미 `runProjectCommand`의
서브커맨드 분기다. `connect`는 세 번째 분기로, 판정 후 두 기존 본문 중 하나로 위임한다.

### A1. 진입점 별칭 (index.ts)

`handlers` 맵에 clone/remote 별칭(index.ts:45-46)과 동형으로 추가:

```ts
connect: (args, ctx) => runProjectCommand(['connect', ...args], ctx),
```

### A2. 중복 제거 — clone/remote 본문을 헬퍼로 추출

현재 clone/remote 로직은 `runProjectCommand` 안에 인라인 `if` 블록으로 있다.
`connect`가 이를 재사용하려면 본문을 로컬 async 함수로 추출한다 (같은 파일 내):

- `doClone(cwd, remoteProjectId, flagArgs)` — project.ts:173-225 본문
- `doRemote(cwd, target, flagArgs)` — project.ts:227-276 본문

`clone`/`remote`/`connect` 세 분기가 모두 이 헬퍼를 호출한다. 동작·출력은
바이트 단위로 불변 (순수 리팩터, 회귀 없음이 acceptance).

### A3. `connect` 분기

```
if (subcommand === 'connect'):
  target = args[1]
  if not target: throw Usage(...)
  hub = parseHubUrl(target)          # 기존 URL 계약 그대로, http(s)+끝 store id
  binding = await getBindingForPath(cwd)
  switch binding?.kind:
    'exact'      -> doRemote(cwd, target, args.slice(2))     # 바운드 프로젝트에 원격 부착
    undefined    -> doClone(cwd, hub.remoteProjectId, ['--remote-url', hub.remoteUrl, ...args.slice(2)])
                                                             # fresh 리플리카
    'ancestor'   -> throw AmbiguousNestingError
```

**판정 규칙 (확정)**:

| 디렉터리 상태 | `getBindingForPath` | 라우팅 |
|---|---|---|
| 이 디렉터리가 프로젝트 루트 | `kind: 'exact'` | **remote** |
| 바인딩 없음 (fresh/빈 디렉터리) | `undefined` | **clone** |
| 상위 프로젝트에 중첩된 하위 디렉터리 | `kind: 'ancestor'` | **에러** |

`ancestor`는 clone(새 중첩 리플리카 생성)인지 remote(상위 프로젝트에 부착)인지
오오인식 여지가 크므로 자동 판정하지 않는다. 명시적 에러로 사용자가 의도를
직접 선택하게 한다:

```
Directory is nested inside project <parentId> (bound at <matchedPath>).
`connect` won't guess here. Run `memorize clone <url>` in a fresh directory
to join as a separate replica, or `memorize remote <url>` to attach THIS
project to the remote.
```

### A4. 헬퍼 계약 (URL 정규화 위치)

추출 후 헬퍼는 **이미 해소된 인자**를 받는다 — URL 파싱을 헬퍼 밖으로 끌어올려
호출자마다 한 번만 한다:

- `doClone(cwd, remoteProjectId, flagArgs)` — `flagArgs`는 `--remote-url` 등이
  이미 포함된 상태. 현재 `clone` 본문의 URL-확장 로직(project.ts:181-185)은
  `clone` 별칭 래퍼로 이동한다 (별칭은 URL 위치 인자를 그대로 받으므로).
- `doRemote(cwd, target, flagArgs)` — `target`은 Hub URL 문자열, 내부에서
  `parseHubUrl`(project.ts:250) 한 번.

`connect`는 이미 `parseHubUrl`한 `hub`를 갖고 있으므로:
- clone 경로 → `doClone(cwd, hub.remoteProjectId, ['--remote-url', hub.remoteUrl, ...rest])`
- remote 경로 → `doRemote(cwd, target, rest)`

이렇게 하면 URL 이중 파싱이 없고 세 호출자의 계약이 일관된다.

### A5. 테스트

- `connect` in fresh dir → clone 동작 (remote 바인딩 + 첫 pull)
- `connect` in bound dir → remote 동작 (원격 부착 + 첫 push/pull)
- `connect` in nested dir → AmbiguousNestingError
- `clone`/`remote` 별칭 회귀 없음 (기존 테스트 그대로 통과)
- URL 파싱 실패 전파 (비-URL, store id 없는 URL)

## B. 웹 카피 (`memorize_hub`) — CLI 배포 후, PR #2

**순서 근거**: 카피가 `memorize connect`를 노출하는 순간, 구 CLI(connect 미지원)
사용자가 복붙하면 깨진다. 그래서 CLI를 먼저 릴리스하고 웹은 그 다음.

### B1. ConnectTab.tsx (packages/web)

두 `CommandBlock`(clone/remote 각각) → **단일 블록**. 최종 구성:

```
Quick setup — if you've done this before     [share URL bar + copy]
  https://…/clone/wsp_abc

Set up on a new machine or project           [command block, whole-block copy]
  memorize login https://…
  memorize connect https://…/clone/wsp_abc

Or hand setup to your AI agent               [one line, copy]
  Follow this guide to set up memorize in this project:
  https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md
```

- 커맨드 블록에서 `npm i -g @shakystar/memorize` 줄 **제거** — 설치·환경변수·훅
  배선은 AI_SETUP 가이드가 담당. 블록은 `login` + `connect` 두 줄만.
- 에이전트 가이드 줄은 사용자가 자기 코딩 에이전트에게 그대로 붙여넣는 한 줄.
  복사 버튼 포함.
- 하단 "After connecting, sync runs automatically at session boundaries." 유지.

### B2. gateway web.ts — 전부 승소

clone/remote 쌍이 노출된 모든 사이트를 동일 패턴으로 통일:

- L123-124 (랜딩 요약), L197-207 (랜딩 상세), L255-263 (헬프면),
  L828-835 (워크스페이스 생성 결과), L886-892 (`/clone/:storeId` 사람 랜딩)

각 사이트에서 `memorize clone …` + `memorize remote …` 쌍 → `memorize connect …`
단일 줄로. `npm i -g` 노출이 있던 곳은 AI_SETUP 가이드 줄로 대체. 카피 문안은
ConnectTab과 일치시킨다.

### B3. 테스트

- `packages/gateway/tests/integration/clone-page.test.ts` — 렌더 결과에
  `memorize connect`가 있고 clone/remote 쌍 노출이 사라졌는지 검증하도록 갱신.
- ConnectTab은 스냅샷/문자열 어서션이 있으면 갱신, 없으면 최소 렌더 확인.

## 수용 기준 (task 원본 + 확정 사항)

- [ ] `connect`가 fresh dir에서 clone, bound dir에서 remote 동작을 자동 판별
- [ ] nested dir에서는 명시적 에러 (자동 판정 안 함)
- [ ] clone/remote 별칭 하위호환 유지 (기존 테스트 회귀 없음)
- [ ] ConnectTab·`/clone/:id` 랜딩·web.ts 전 사이트 카피가 `connect` 단일 줄 + AI_SETUP 가이드 줄로 일치
- [ ] CLI PR가 먼저 머지/릴리스된 뒤 웹 PR 머지

## 열린 사항

- 없음 (분기 규칙·웹 모양·승소 범위·레포 순서 모두 확정).
