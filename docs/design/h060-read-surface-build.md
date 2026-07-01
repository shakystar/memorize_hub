# H060 read/write surface — 빌드 스코프·접근 플랜

> 상태: DRAFT / 플랜 (빌드 전, 로드맵 **맨 마지막** 순번). [[H060]] Decision을 "지을
> 준비" 상태로 구체화한다 — SoT 결정을 바꾸지 않고 **스코프·경계·재사용·단계**만 확정.
> 근거: Hub SoT(H010/H020/H030/H040/H060/H070/H900) + `../memorize` 도메인 엔진 실사
> (`src/adapters/sync-transport-http.ts`, `src/projections/projector.ts`,
> `src/mcp/server.ts`, `src/services/*`) + `docs/protocol/workspace.md` 와이어 계약.
>
> **권위**: HSoT(H0xx) + memorize SoT **뿐**이다. 이 문서는 그 아래의 빌드 플랜이며,
> 충돌 시 SoT가 이긴다 — 확정·연기 결정의 authoritative 기록은 해당 SoT 문서(연기는
> [[H900]])다. 이 문서는 그것을 **인용·구체화**할 뿐 새 권위를 만들지 않는다.

## 0. 이 문서가 하는 것 / 안 하는 것

- **한다**: H060의 headless replica read/write surface를 **어떤 스코프로, 무엇을
  재사용해, 어떤 순서로** 짓는지 확정. 착수 전 선결 결정을 목록화.
- **안 한다**: SoT 재결정(컴포넌트 정체성·경계는 [[H060]] 불변), 지금 착수(로드맵
  마지막이라 나머지 제어평면·전송·클라이언트 완료가 선행, [[H900]]).

## 1. 컴포넌트 정체성 (불변, [[H060]])

read/write surface는 **relay를 소비하는 별도 headless memorize replica**다. relay나
gateway의 확장이 **아니다**.

- **왜**: 도메인 이벤트를 author하거나 union을 project하려면 task·rule·기억이 무엇인지
  아는 **완전한 memorize 도메인 엔진**이 필요하다. relay는 opaque(도메인 무지)이고
  gateway는 control-plane 전용이라, 그 지식을 넣으면 2-plane 경계가 깨진다([[H010]]).
- **귀결**: Hub는 **새 도메인 엔진을 짓지 않는다**. 기존 memorize 패키지를 서버측에서
  **headless로 호스팅**할 뿐이다. 이 정체성은 배포 무게(§6)와 무관하게 불변이다.

## 2. 재사용 자산 (`../memorize`) — "새로 짓는 건 얇은 host"

replica가 필요로 하는 도메인 로직은 memorize에 **이미 다 있다**. 새 빌드의 실체는
그것들을 서버측에서 엮는 **얇은 headless host + 인증/정체성 배선**이다.

| 필요 | 재사용 자산 (`../memorize`) |
| --- | --- |
| `wsp_` 로그 push/pull (relay events route, byte-for-byte) | `src/adapters/sync-transport-http.ts` |
| 수렴 오케스트레이션 (pull→merge→dedup by `event.id`) | `src/services/sync-service.ts`, `auto-sync-service.ts` |
| raw union → consolidated view (dedup·cluster·모순플래그) | `src/projections/projector.ts` + `services/consolidate-service.ts`, `contradiction-service.ts`, `projection-store.ts` |
| read surface (remote MCP tools) | `src/mcp/server.ts` |
| 도메인 이벤트 author (기억 추가·task cancel·rule 편집) | `src/services/capture-service.ts`, `task-service.ts` + `src/domain/*` |
| 서버측 이벤트 저장소 (`memorize.db`) | `src/storage/*` (서버 경로에 격리된 `MEMORIZE_ROOT`) |

**결론**: 새로 짜는 도메인 로직 ≈ 0줄. 빌드 = ① headless host 프로세스, ② replica가
쥘 **authoring 계정 정체성**, ③ 배포 형태(§6). 나머지는 memorize 임베드.

## 3. 경계 (relay·gateway 무오염)

- **relay**: 무변경. `wsp_` 로그는 여느 opaque 로그이고, replica는 그 로그의 **또
  하나의 writer/reader**일 뿐이다([[H020]] "union의 또 다른 writer"). append-only가
  특별처리 없이 흡수한다.
- **gateway**: control-plane 전용 유지. replica를 **account principal**로 인증하고
  `authorize()` 단일 게이트로 멤버 자격을 판정한다([[H030]]). projection·query·랭킹은
  gateway에 **넣지 않는다**([[H010]], `docs/design/gateway-web-ux.md` §1).
- **경로**: replica는 클라이언트와 **동일한 공개 edge**로 events route를 호출한다 —
  gateway가 내부 relay 토큰을 주입한다(별도 특권 경로를 만들지 않는다).

## 4. write path (서버판 "쓰기는 edge에서", memorize #92)

```
UI edit (기억 추가 / task cancel / rule 편집)
  → replica가 DomainEvent author (provenance = 서버측 계정, writer + sourceProjectId)
  → 로컬 서버 memorize.db append
  → POST /v1/projects/:wsp_/events  (opaque events route, byte-for-byte)
  → 바인딩된 모든 레포가 pull → whole-DB union 수렴
```

- 새 event envelope 없음. 서버 author 이벤트는 **union의 또 다른 writer**일 뿐이라
  기존 append-only 병합이 흡수한다([[H020]], memorize SoT-030/040).
- **provenance**: 모든 `DomainEvent`가 이미 `writer` + `sourceProjectId`를 싣는다.
  서버 author 이벤트의 `writer`는 replica가 쥔 계정 → UI 렌더 라벨("web"/"server" 등)
  확정 필요(§7.1).
- owner-only **global retract**은 write-time이 아니라 **projection-time**에
  writer role로 판정한다(`workspace.md` 데이터평면 §, [[H030]]).

## 5. read path (예외 모드 전용)

```
replica가 wsp_ union pull → projector가 consolidated view 로컬 빌드
  → 대시보드 / remote MCP / 클라우드 쿼리로 노출
```

- **예외 모드**다: (a) 한 워크스페이스 코퍼스가 로컬에 다 담기엔 너무 크거나, (b)
  per-query 취소가능 ACL이 필요할 때만. 두 해피패스(HP1·HP2)는 각 레포가 로컬에서
  union을 빌드하므로 이 경로를 **안 쓴다**([[H060]], memorize SoT-060).
- Hub는 **어떤 LLM도 안 돌린다**. 읽기/주입 hot-path는 기계적이고, write-time
  salience 점수·태깅은 memorize 클라 몫이다(memorize SoT-060).

## 6. 배포 형태 (무게 스펙트럼, 정체성 불변)

| 형태 | 언제 | 수명 |
| --- | --- | --- |
| **A. on-demand authoring** | write 먼저 쓰는 첫 용례 (UI 편집) | write당 단명 기동 → author+push → 종료 |
| **B. 상시 read 서비스** | read 수요 도래 (대시보드·클라우드 MCP·큰 코퍼스) | 장수, warm projection 유지 → query 서비스 |

같은 컴포넌트, 다른 무게. 워크스페이스/모드별로 갈릴 수 있다. **시작은 A**(가볍고
write-at-edge 첫 용례에 맞음), read 수요가 서면 B로 승격.

## 7. 착수 전 선결 (build 전 못박을 것)

- **7.1 authoring 계정 정체성** — replica가 어떤 account로 author하나? (a) Hub 서비스
  계정 1개가 서비스하는 `wsp_`들의 멤버, (b) 워크스페이스별 서비스 계정 중 택1.
  provenance 렌더·감사·retract 권한에 직접 영향. **결정 필요.**
- **7.2 서버-author 이벤트 인가** — 같은 [[H030]] 정책 계층을 통과한다. replica는
  **scoped·non-`read_only`** 키(또는 세션)를 쥐고, 멤버-coarse ACL을 그대로 받는다.
  per-item publish 권한은 없다(memorize SoT-040: 멤버십 = publish).
- **7.3 at-rest / E2E 제약** — 워크스페이스 payload는 **plaintext-to-server**라
  replica가 project할 수 있다([[H070]]). **E2E에 opt-in한 워크스페이스는 서버
  projection을 포기**하므로 그 워크스페이스엔 read surface를 제공하지 않는다 — 명시 필요.
- **7.4 authoring 화이트리스트** — UI에서 무엇을 author 허용하나(add memory / cancel
  task / edit rule …). memorize 도메인 이벤트 부분집합으로 못박는다.
- **7.5 임베드 엔진 버전 관리** — replica는 union의 **또 하나의 memorize 소비자**이므로
  클라이언트와 **동일한 버전 채널**을 탄다. 세부:
  - **채널 = 퍼블리시된 패키지.** `@shakystar/memorize`(npm, self-update via
    `src/services/update-service.ts`)를 **의존성**으로 소비한다 — fork·submodule·소스
    복사 금지(드리프트의 원천). §2의 "새 도메인 코드 0줄" 원칙과 일치.
  - **자동 승급 + 게이트.** Renovate가 새 릴리스에 PR → Hub CI가 golden round-trip
    계약 테스트로 게이트 → 머지 시 Fly 연속 배포(M5)로 replica 재기동. blind latest가
    아니라 "게이트 통과한 latest가 연속적으로".
  - **배포별 최신(§6):** 형태 A(on-demand)는 이미지 빌드 시점 핀; 형태 B(상시)는 bump
    머지 시 재배포로 반영.
  - **호환성 관리 = TBD (서비스 기능 안정화 후 확정, 권위 기록은 [[H900]]).** 클라이언트가
    서버와 독립·비동기로 업데이트되므로 union에 replica가 모르는 **더 새로운 스키마
    이벤트**가 섞일 수 있다. 의도된 형태: replica가 자기 schema/event 버전을 기록하고,
    모르는 스키마를 만나면 **project 거부(fail-safe)** 로 틀린 consolidated view를
    막는다(memorize `src/domain/common.ts`의 기존 schemaVersion 재사용). 다만 event
    스키마가 아직 churn 중이라 지금 compat 계약을 못박으면 조기 최적화 — **기능 안정화 후**
    구체 규칙(버전 비교·거부 임계·마이그레이션)을 확정한다.

## 8. 선행 의존성 / 착수 트리거

- **선행(로드맵 순서)**: gateway 리빌드 완료 + 전송 + 클라이언트를 **먼저** 끝낸다.
  H060은 맨 마지막 순번이다([[H060]], [[H900]]).
- **착수 트리거(게이트 아님, 앞당길 신호)**: 첫 claude.ai 소비자 / 로컬에 안 담기는
  코퍼스 / 브라우저 워크스페이스 UI 수요(`gateway-web-ux.md` R3의 H060 예약 캔버스).

## 9. 단계 분할 (S1..S4)

- **S1 — write MVP (배포 A)**: headless host가 memorize 임베드, 서비스 계정으로 `wsp_`
  멤버십 보유, 단일 "author event" 내부 호출 → relay push. **검증**: 바인딩된 레포가
  그 이벤트로 수렴.
- **S2 — read projection surface (배포 B)**: 장수 replica가 `wsp_` union projection을
  유지, remote MCP / JSON 쿼리로 read 노출(gateway auth 뒤).
- **S3 — 브라우저 캔버스 배선**: `gateway-web-ux.md`의 예약 캔버스(H060 placeholder)가
  replica의 read/write를 **gateway 경유로** 호출. "개발 예정" 슬롯을 채운다.
- **S4 — 예외모드 read 강화**: 코퍼스-too-large 클라우드 쿼리 + per-query 취소가능
  ACL + remote MCP 하드닝.

## 10. 비목표 (안 하는 것)

- Hub에서 **LLM 실행**(write-time salience는 memorize 클라 몫).
- relay/gateway에 **projection·query·랭킹·임베딩·도메인 스키마**([[H010]],
  `gateway-web-ux.md` §1).
- 두 해피패스를 이 surface에 **의존**시키기 — 어디까지나 additive·예외 모드다.

## 관련 (Related)

[[H060-consolidation-and-read-surface]], [[H010-two-plane-boundary]],
[[H020-workspace-transport]], [[H030-authorization-policy]],
[[H040-control-plane-data-model]], [[H070-at-rest-encryption]],
[[H900-open-decisions]]; `docs/design/gateway-web-ux.md`,
`docs/protocol/workspace.md`; `../memorize` SoT-030/040/050/060.
