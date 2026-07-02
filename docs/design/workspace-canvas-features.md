# 워크스페이스·개인 메모리 캔버스 - 기능 스펙 (타임라인 우선)

> 상태: DRAFT / 기획(구현 전). `gateway-web-ux.md`(R2)가 예약해 둔 메인 캔버스
> placeholder를 무엇으로 채울지 정한다. 근거: Hub SoT(H010/H030/H040/H060/H080/
> H900) + memorize 도메인 실사(`src/domain/entities`, `src/domain/events.ts`) +
> 2026-07-02 기획 세션.
>
> **권위는 SoT에 있다.** 이 문서는 캔버스의 수요측 스펙이며 충돌 시 SoT가 이긴다.
> 특히 [[H060]] 착수 전 선결 결정(§7.1 authoring 계정 정체성/provenance 라벨,
> §7.4 authoring 화이트리스트)의 **수요측 입력**으로 쓰인다. SoT에 새 결정을 직접
> 쓰지 않는다(append-and-supersede 규율).

## 0. 확정 결정 (2026-07-02 세션)

- **주 타깃 = P5 첫 방문자, 비개발자 포함 "에이전트를 잘 쓰는 직업군"**(디자이너·
  기획자·개발자 등). 근거 정합: M4의 GitHub→Google OAuth 전환(비개발자를 GitHub
  계정에 가두지 않기), [[H080]] 셀프서브(베타 게이트 없음), device-auth(#45, 키
  복사 없는 브라우저 승인). 귀결: UI 언어는 비개발자 legible - `wsp_`/`proj_`/
  watermark 같은 내부 용어를 1급 화면에 노출하지 않는다(§6 용어 번역층).
- **캔버스 1급 축 = 타임라인/활동형.** 세 근거: (a) P5의 빈-상태 문제를 온보딩
  피드 전환으로 유일하게 해결하고, (b) replica 전에 실데이터([지금] 층 sync 활동)로
  채울 수 있는 유일한 축이며, (c) "오늘 내 에이전트가 배운 것"이라는 비개발자
  문법이다. 지식베이스·검색은 1급이 아니라 탭/상단 보조.
- **검색(recall) = 상단 글로벌.** 고정 검색바 + 커맨드팔레트, 탭 아님. 자연어
  질문형 UX이되 **LLM이 아니다** - 기계적 recall이 관련 기억을 반환한다([[H060]]:
  Hub는 어떤 LLM도 안 돌림).
- **탭은 넓게 스펙한다.** 탭 수는 늘어날 전제고, task 등록·decision 등록 같은
  UI-authoring도 후속 단계에 포함한다(§5). 단 렌더는 "억지로 채우지 않는다" 원칙
  그대로 - 구현된 것만 + 개발 예정 배지(`gateway-web-ux.md` §5).
- **타임라인 표현 문법 = 채팅형** (2026-07-02, 첫 슬라이스 시각 검증에서 확정,
  #48). 내 항목은 오른쪽 말풍선(이름 없음), 다른 멤버는 왼쪽 아바타+이름, 연속
  발화 그룹핑, 날짜 구분선 중앙, 시간순(최신이 아래) + 진입 시 맨 아래 스크롤.
  세션 시작/종료는 말풍선이 아니라 **중앙 시스템 라인**. 항목의 귀속 단위는
  **member(계정)** - 서버가 source store를 소유 계정으로 해석해 내려주고(wire에
  `member` 필드), 에이전트·레포(`writer` · source label)는 말풍선 안 메타로 강등.
  "내 것 vs 남의 것"이 한눈에 갈리는 게 목적이다.
- **sync 도착은 피드 아이템이 아니다** (2026-07-02, 같은 검증에서 확정). sync는
  실시간화(H900의 SSE 방향)를 전제하므로 per-arrival 행은 타임라인을 폭주시킨다.
  sync 가시성은 **집계 표현**(멤버별 "마지막 동기화" 인디케이터 등, members 크롬
  쪽)으로 옮긴다. 이로써 §2의 "[지금] 층 실데이터로 타임라인을 채운다"는 근거는
  약화되고, now-층에서 타임라인이 갖는 것은 **온보딩 빈 상태 + 첫 sync 도착
  감지**로 좁혀진다 - 축 선택의 나머지 두 근거(P5 빈-상태, 비개발자 문법)는 유효.
- **지식 탭 제거, Talk 탭 추가** (2026-07-03). 출시 탭은 Timeline·Tasks 둘;
  나머지(Talk/Decisions/Sources)는 TBD 그룹으로 탭바에서 구분선 분리. Talk는
  placeholder에 구현 메커니즘을 명시한다(§3). 지식의 역할은 검색·결정·타임라인
  으로 분산, 부활 후보는 memory map(§8).
- **소스(Sources) 탭 추가** (2026-07-02 후속 세션). 기억이 참조하는 원본 파일을
  워크스페이스에 올려 다른 기기의 에이전트가 요청 시 받아가게 한다. 저장소의
  자리는 relay가 아니라 **모노레포 세 번째 패키지**(gateway-fronted 불투명 블롭
  저장소, §3 상세). v1은 탭 + 정의 + 개발 예정 배지만 - 실 구현은 별도
  서브시스템(SoT 새 H-항목 후보)이라 캔버스 슬라이스로 당기지 않는다.

## 1. 사용자 정의 (SoT 유도 페르소나)

SoT가 명시하는 사용자 축은 셋이다: 해피패스(HP1/HP2, SoT README), 역할(owner/
member, [[H040]]; read_only 직교축, [[H030]]), 온보딩([[H080]] 셀프서브). 조합:

- **P1 솔로 빌더** (HP1) - 1계정·N레포·M기기, 1-멤버 private 워크스페이스. "내
  두뇌가 레포·기기 경계 없이 이어진다". 검색·지식 조회·sync 건강이 절실.
- **P2 팀 멤버** (HP2, member) - 남의 기억이 내 union으로 합류. publish = sync
  (멤버십=publish, memorize SoT-040). 자기 것만 retract.
- **P3 워크스페이스 오너** (HP2, owner) - P2 + 관리·모더레이션: invite 민팅/회수,
  역할 변경, 삭제, 아무 멤버 assertion이나 global retract([[H040]]).
- **P4 read-only 뷰어** ([[H030]]) - read_only 키/좌석으로 열람만. 역할과 직교라
  P2·P3 어디에도 겹침. 기능이라기보다 **모든 authoring UI의 가드 조건**(§5).
- **P5 첫 방문자** ([[H080]]) - OAuth 로그인 직후, 워크스페이스 0개 또는 빈
  워크스페이스. 게이트가 없어 아무도 안내해주지 않는 상태로 도착. **주 타깃.**

**개인 메모리 페이지의 사용자는 P1의 개인판 하나뿐**이다 - `psm_`은 owner-only
(계정 단위, 공유 불가)라 페르소나 분기가 없다.

## 2. 층 구분 (모든 기능에 태그)

- **[지금]** - control-plane 데이터만으로 가능([[H010]] 준수): 멤버/역할, invite,
  sync watermark·usage, 스토어 크기, sync 도착 감지. gateway가 이미 아는 메타데이터.
- **[replica]** - [[H060]] read/write surface(별도 headless memorize replica) 필요.
  기억 **내용**의 브라우즈·쿼리·authoring 전부. 로드맵 맨 마지막 순번
  (`h060-read-surface-build.md`).
- **[연기]** - [[H900]] 연기 항목과 결합: opt-out publish 정책, retention, realtime
  SSE, entitlements/quota. "개발 예정" 라벨 자리만.

구조적 사실: **[지금] 층의 실데이터는 전부 활동/sync 계열**이다(watermark, usage,
도착 이벤트). 기억 내용은 전부 [replica]. 이것이 타임라인 1급의 근거 (b)다.

## 3. 워크스페이스 캔버스

**상단 크롬**: 워크스페이스 이름 + 글로벌 검색바(§0) + members + [설정] (members/
invites/roles/leave/delete는 기존 구현 유지).

**탭** (넓게 스펙, 단계 라벨과 함께):

- **타임라인** (기본 탭, 채팅 문법 - §0)
  - later-층 [replica]: 도메인 이벤트를 채팅으로 - `memory.consolidated`,
    `decision.accepted`, task/handoff는 member별 말풍선(kind/status 배지 +
    본문 + `writer` · source label 메타), session 시작·종료는 시스템 라인.
    멤버 필터 칩. sync 도착은 여기 없다(§0) - 대신 멤버별 "마지막 동기화"
    인디케이터 [지금: 현 `usage.ts`는 store x 일 집계뿐이라 계정·시각 귀속은
    프록시가 이미 아는 principal을 함께 기록하는 additive 확장 필요(content는
    안 읽음, [[H010]] 보존); 레포별 귀속은 payload 안이라 [replica] 전용].
  - **빈 상태 = 온보딩** [지금]: "내 에이전트 연결" 가이드 - 하니스별 설치 안내 +
    `memorize login`(device-auth, 키 복사 제로) + 첫 sync 도착을 화면이 감지해
    축하하는 "aha". 현 sync 퀵스타트 블록의 진화형.
- ~~**지식**~~ **v1 캔버스에서 제거** (2026-07-03 결정, mock까지 만들었다 폐기).
  역할이 다른 표면으로 분산됐다: 목적어 있는 회수 → 글로벌 검색, 현재 결정
  상태 → 결정 탭, 흐름 → 타임라인. 부활 후보 아이디어로 **memory map**(임베딩·
  태그 기반 클러스터 그래프) [replica]가 있으나 결정 아님 - §8 참고.
- **Talk** [replica + memorize 협력]: 워크스페이스 에이전트에게 말 걸기. 메커니즘
  까지 탭 placeholder에 명시(방문자가 허풍으로 안 믿는 문제 방지): 웹에서 쓴
  메시지가 공유 로그의 이벤트가 되고, 각 멤버의 에이전트가 다음 sync 때 풀해
  세션 시작 시 주입받는다. **Hub는 LLM을 안 돌린다([[H060]]) - 답하는 지능은
  항상 사용자 기기.** 2단계: ①비동기(음성사서함형, authoring 1단계의 message
  이벤트로 충분) → ②실시간(H900 SSE push + 기기 쪽 상시 구독 에이전트 필요,
  memorize 신규 컴포넌트). v1은 탭 + 정의 + 개발 예정 배지만.
- **작업** [replica]: task/handoff/checkpoint 보드(진행중/handoff_ready/done).
- **결정** [replica]: decision 로그(proposed→accepted→superseded 체인). "우리가
  뭘 왜 결정했나" - 기획자 타깃 친화.
- **소스(Sources)** [신규 서브시스템 - 아래]: 기억이 가리키는 원본 파일 저장소.
  기억 텍스트에는 파일 참조가 그대로 박히는데(구조화 필드는
  `sourceObservationIds`·`filePath` 정도) 그 원본은 한 멤버의 기기에만 있다.
  개발자끼리는 git이 공유 소스 저장소 역할을 하지만 주 타깃(P5 비개발자)에게는
  git이 없으므로, 공유 두뇌의 보완재로 워크스페이스 파일 서랍이 필요하다 -
  멤버나 그 에이전트가 요청 시(fetch-on-demand) 받아가는 곳. v1은 탭 + 정의 +
  개발 예정 배지만(2026-07-02 결정).
- 규칙(rule)·충돌(conflict)은 v1 탭이 아니다 - 지식/타임라인의 필터·배지로
  시작하고 수요가 서면 탭으로 승격(스코프컷 아님).

**소스 저장소의 자리 (SoT 새 H-항목 후보, 이 문서는 입력만 기록)**: relay에는
넣지 않는다 - relay는 전 replica가 전부 pull하는 이벤트 로그라 블롭을 넣으면
모든 기기가 모든 파일을 강제 수신하고 "작고 멍청한 큐" 원칙이 깨진다. 맞는
자리는 **모노레포의 세 번째 패키지**(가칭 depot): 내용-주소 블롭 저장소,
relay와 같은 패턴(내부 전용 + 토큰 게이트 + `/data` 볼륨, 내용은 불투명
바이트 - 클라이언트 암호화 가능, [[H010]] 보존), gateway가 워크스페이스 ACL로
fronting. 이벤트 sync가 git이라면 이것은 git-LFS 패턴(fetch-on-demand,
sync-all 아님). 실 S3(Fly Tigris 등) 채택 여부는 패키지 내부 구현 선택으로
연기. 공수: PROTOCOL.md wire 계약 + memorize 클라이언트 verb + quota/retention
([[H900]] 주제)이 따라오므로 캔버스 슬라이스로 당기지 않는다.

**provenance 표시**: 모든 도메인 이벤트가 이미 `writer` + `sourceProjectId`를
싣는다(memorize 3.0.0 Phase 0, 현재 캡처만 되고 미소비). 캔버스가 이것의 첫
소비자다 - "누가 · 어느 레포에서" 라벨. 서버-author 이벤트(§5)의 표기("web" 류)는
[[H060]] §7.1이 정할 것(§7 역류).

## 4. 개인 메모리 페이지

같은 프레임에서 members/공유 크롬만 제거:

- **타임라인** [replica]: 개인 기억 흐름 + **감사 뷰** = "어떤 에이전트가 어떤
  세션에서 나에 대해 뭘 적었나" 필터.
- **지식(개인)** [replica]: 프리퍼런스·작업스타일이 쌓이는 곳, 워크스페이스 지식
  탭과 동일 문법.
- **프라이버시 보증 표면** [지금]: "`psm_`은 어떤 워크스페이스로도 안 나간다"를
  문구가 아니라 데이터로 - 이 스토어의 sync 상대가 개인 스토어뿐임을 보여준다.
- 빈 상태 = 타임라인과 동일한 온보딩 + personal import 안내.

## 5. UI-authoring 단계 (→ [[H060]] §7.4 화이트리스트 입력)

넓게 + 단계적. 탭 수처럼 authoring 표면도 늘어날 전제로 스펙한다:

- **1단계**: 기억 추가(note), 자기 기억 retract.
- **2단계**: task 등록/취소, decision 등록/supersede.
- **3단계**: rule 편집, 오너 global retract(모더레이션 - write-time이 아니라
  projection-time에 writer role로 판정, [[H030]] + `workspace.md` 데이터평면).
- **P4(read_only) 가드**: 전 단계에서 authoring 진입점 숨김/비활성.

모든 단계가 [replica]다: UI 편집은 replica가 DomainEvent를 author해 opaque events
route로 push하는 write path([[H060]] 빌드플랜 §4)를 탄다. gateway에 authoring을
넣지 않는다([[H010]]).

## 6. 비개발자 렌즈 (승격 항목)

- **브라우저-온리 join 경로** [replica]: 초대 링크 → Google 로그인 → join → 팀
  기억을 웹에서 바로 열람, CLI 없이. 비개발자의 첫 경험일 확률이 높다. CLI 설치는
  "내 에이전트도 여기 기억을 쓰게 하기" 후속 단계로 밀린다.
- **용어 번역층**: 내부 id ↔ 표시 언어 표 - `wsp_`→워크스페이스, `psm_`→개인
  기억, watermark→마지막 동기화, ConsolidatedMemory kind→결정/이유/진행. 내부
  id는 상세 패널에서만.
- **읽기 전용 소비가 1급 시민**: 비개발자는 authoring보다 열람 비중이 크다 -
  P4 경험이 엣지케이스가 아니라 주 경로의 부분집합.

## 7. H060으로의 역류 (선결 결정 입력)

- **§7.1** (authoring 계정 정체성): 캔버스는 서버-author 이벤트의 provenance
  라벨("web"/"server" 류) 렌더를 요구한다 - 정체성 결정 시 라벨 규약을 함께.
- **§7.4** (authoring 화이트리스트): 이 문서 §5의 단계적 화이트리스트가 수요측
  답안이다.
- **타임라인 now-층은 replica 불요**: [[H060]] 착수 전에도 캔버스에 실데이터를
  제공할 수 있다 - read surface 빌드의 트리거 신호(브라우저 UI 수요) 측정에도
  쓰인다.

## 8. 이 문서가 안 정하는 것

- 빌드 시점·순서: read surface는 로드맵 맨 마지막([[H900]]), now-층 선구현 여부는
  별도 실행 결정.
- E2E opt-in 워크스페이스는 서버 projection을 포기하므로 [replica] 기능 전부를
  제공하지 않는다([[H070]], `h060-read-surface-build.md` §7.3) - 그 UI 표기는
  E2E 착수 시 결정.
- tier/quota 수치([[H080]] entitlements seam) - 결제 도입 시점의 결정.
- **memory map**(지식 탭 부활 후보): 임베딩·태그 기반 클러스터 그래프. 재료는
  이미 있다 - 클라이언트 memorize.db에 `embeddings` 테이블이 있고 tags 채움율
  97-100% 실측. 단 임베딩이 이벤트가 아니라 로컬 projection이라 replica 쪽
  재계산 vs 동기화 결정이 선행돼야 하고, 그래프 뷰의 실사용 가치(Obsidian
  graph 류의 "한 번 보고 마는" 위험) 검증도 필요 - 데모/랜딩 시각 자산으로의
  가치와 분리해서 판단할 것.
