# H900: 미결·연기 결정

상태(Status): Open
확정(Since): 2026-07-01
대체함(Supersedes): —
대체됨(Superseded-by): —

## 진술 (Statement)

2026-07-01 설계 세션에서 확정된 것은 home 문서(H010~H070)로 옮겼다. 여기 남는 것은
**연기(결정: 나중에 빌드)** 항목들과, 각 항목이 **착수 전 선결**해야 할 진짜 미결이다.
연기는 "안 정함"이 아니라 "지금 안 만듦"이다 - 가능한 한 의도된 형태까지 적어 둔다.

## 연기 (decided: defer, build later)

- **opt-out publish 정책** - 연기. v1 기본값은 share-all(캡처되면 기본 공유, memorize
  SoT-040). 의도된 형태: **워크스페이스-레벨 advisory 정책** - owner가 설정하고 Hub가
  control-plane 메타데이터로 보관하며 클라이언트가 honor한다(Hub는 opaque라 강제 못 하는
  advisory). per-item이 아니라 **카테고리/층 단위** 필터다([[H040]] 참조; 두 해피패스는
  기본값만 쓴다).
- **headless read/write surface** - 연기, 트리거-gated. #92 클라우드 쿼리·remote MCP·
  대시보드·워크스페이스 웹 UI(사용자가 UI에서 기억·task·rule 추가/편집). **트리거**: 첫
  claude.ai 소비자 / 로컬에 안 담기는 코퍼스 / 브라우저 UI 수요. 형태: relay를 소비하는
  별도 memorize replica(read이자 write), 무게는 스펙트럼이나 컴포넌트 정체성은 불변
  ([[H060]]).
- **E2E 암호화** - 연기, 수요-gated(memorize SoT-070/900 상속, [[H070]]). 의도된 형태:
  store별 DEK를 등록 기기 public key로 envelope 래핑, 서버엔 래핑된 DEK + public key만.
  **착수 전 선결 = 복구 정책**(단일 기기 분실 시 영구 소실): 오프라인 복구키 / 서버 매개
  복구(E2E 약화) / 다중 기기 상호 복구 중 택1을 빌드 *전에* 못박아야 한다.
- **realtime SSE/websocket push** (memorize P3-c: 크로스머신 라이브 워터마크 델타) -
  연기. poll-on-boundary sync로 v1 충족.
- **워크스페이스 retention/compaction** - 연기(로드맵). 공유 `wsp_` 로그의 바이트 회수는
  retract 전파 후 replica별 lazy 압축으로(memorize SoT-050).
- **결제 tier(free/team/pro) 정의·가격·quota 수치** - 연기, 코어 완결 후 layered
  ([[H080]]). seam은 `authorize()` 단일 게이트로 확정됐고 엔드포인트 계약은 불변; 미결은
  각 tier의 실제 한도값(계정당 워크스페이스/멤버 상한, retention 창 등)과 가격이다.

## 닫힌 결정 (이 문서에서 이동)

- **모든 원격 store id = server-minted** (2026-07-01 확정, [[H050]]): private 프로젝트도
  1-멤버 `wsp_`, `proj_`는 로컬+provenance. memorize SoT-020 문자 그대로.
- **opt-out 위치** (2026-07-01): 위 "연기"로 방향 확정(워크스페이스-레벨 advisory 메타).
- **read/write surface** (2026-07-01): trigger-gated 연기로 확정(위).

## SoT 밖 (아키텍처 불변식 아님)

- **리빌드 실행 순서** (legacy 이관 → 새 `packages/gateway` 골격 → 검증된 코어 이식 →
  workspace)는 프로젝트 플랜이지 SoT 결정이 아니다. 별도 리빌드 플랜에서 다룬다.

## 관련 (Related)

[[H040-control-plane-data-model]], [[H060-consolidation-and-read-surface]], [[H070-at-rest-encryption]], [[H050-identifier-namespaces]], [[H010-two-plane-boundary]]
