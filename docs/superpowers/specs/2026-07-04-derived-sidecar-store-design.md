# 파생물 사이드카 스토어 (derived-artifact sidecar store) — 설계

> 상태: DRAFT / 설계 승인됨 (2026-07-04, 브레인스토밍 세션). 구현 착수 전.
> 권위: Hub SoT(H010/H020/H030/H050/H060/H070) + memorize SoT. 충돌 시 SoT가 이긴다.
> 관련 클라이언트 설계: `../memorize` 의 `search --union` (2026-07-04) — 이 문서는
> 그 결정과 **충돌하지 않도록** 스코프를 잘랐다(§0.2 참조).

## 0. 배경

### 0.1 동기

로컬에서 union된 기억의 임베딩 벡터를, 같은 유저의 **다른 기기가 재임베딩 없이
이어받게** 하고 싶다. 수십만 건 규모에서 새 기기마다 전 코퍼스를 재임베딩하는 것은
지연 + 임베딩 API 비용이다. 벡터는 `(text, model, model-version)`에 대해 결정론적이라,
한 번 계산한 값을 기기 간에 공유하면 재계산을 건너뛸 수 있다.

물음: **Hub가 이 벡터 공유의 base(전송·제어평면 배선)를 제공할 수 있는가?**

### 0.2 충돌과 해소 (self vs foreign)

병렬 세션이 `memorize` 레포에서 `search --union`을 확정했다. 그 슬라이스는
**의도적으로 foreign 임베딩 벡터를 복제하지 않는다** — union 검색을 로컬 FTS-only로
두고, semantic-over-union은 미래 서버측 그래프 검색 엔진(= H060 read surface)이 흡수할
throwaway로 판단했기 때문이다.

해소의 열쇠는 **self / foreign 구분**이다:

- **self 벡터(같은 유저의 기기 간, 부모 store가 1-멤버):** 새 기기가 자기 코퍼스를
  재임베딩하는 비용을 없앤다. 오늘 소비자(self-lane hybridSearch)가 있고 서버 엔진이
  생겨도 안 버려진다. sibling이 미룬 대상이 **아니다.**
- **foreign 벡터(워크스페이스 다-멤버):** 로컬 semantic-over-union의 재료. 이것이
  sibling이 서버측으로 미룬 부분이다.

**결론:** Hub base는 부모 store의 **멤버 수에 무지**하게 짓는다. self는 부모가 1-멤버인
경우일 뿐이고, foreign 워크스페이스는 **동일 파이프**다. 차이는 오직 **클라이언트의
foreign-reader를 지금 켜지 않는다**는 것 — 그래서 Hub base는 general하게 짓되 첫
소비자만 self로 검증하며, sibling의 server-side 베팅과 충돌하지 않는다.

### 0.3 왜 "임베딩 패키지"가 아니라 "파생물 사이드카"인가

임베딩은 첫 입주자일 뿐이다. 재사용 가능한 프리미티브는 **"원본 store(source-of-truth
이벤트)에 바인딩된, 파생·재생성 가능 아티팩트 전용 사이드카 store"** 이다. 속성:
(1) 부모 ACL 상속, (2) 파생물이라 독립적으로 prune/compact/rebuild 안전,
(3) opt-in/lazy pull, (4) source `event.id` + model/version 태그로 키잉. 나중 입주자
후보(2026-07-03 벤치마크·카운팅 논의): FTS 블롭, 요약, 접근 카운트/last_accessed
텔레메트리, 랭킹 신호. 여러 입주자가 예정돼 있어 general 프리미티브를 지금 짓는 것이
YAGNI 위반이 아니다.

## 1. 스코프 경계

- **memorize_hub가 짓는다:** 범용 파생물 사이드카 store의 전송·제어평면 base — gateway가
  부모 store에 바인딩된 파생 store를 mint·ACL 상속·프록시.
- **memorize(sibling 레포)가 짓는다:** 임베딩 DomainEvent kind + projector insert +
  model 매칭 재사용/재임베딩 fallback. **Hub 스코프 밖**(H060: Hub는 도메인 엔진을 안
  짓는다). §8의 cross-repo task로 위임.
- **불변 준수:** relay/gateway에 임베딩·랭킹·projection 없음(H010). 벡터는 **통과**만
  한다. relay가 계산하는 것이 아니라 opaque 바이트가 relay를 지나는 것 — 경계 무해.

## 2. 프리미티브: 파생물 사이드카 store (gateway)

`personal-store.ts` 의 get-or-create 패턴을 본뜬다.

- **새 id kind `der_`** (`ids.ts` `IdKind` 에 추가, `isReservedId` 에 등록). 아티팩트
  종류는 id 프리픽스가 아니라 **컬럼**(`artifact_kind`)으로 구분 — 한 네임스페이스가
  임베딩·FTS블롭·요약 등 여러 입주자 공용.
- **새 테이블** (Hub SoT H040 계열, gateway.db 마이그레이션 v+1):

  ```sql
  CREATE TABLE derived_stores (
    parent_store_id TEXT NOT NULL,
    artifact_kind   TEXT NOT NULL,   -- 'embedding' (첫 입주자)
    store_id        TEXT NOT NULL UNIQUE,  -- der_…
    created_at      TEXT NOT NULL,
    PRIMARY KEY (parent_store_id, artifact_kind)
  );
  ```

- **get-or-create DAL** — `getOrCreatePersonalStore`(`personal-store.ts:23`)의 구조
  복제. 멱등: `(parent_store_id, artifact_kind)` 존재 시 기존 der_ 반환, 없으면
  `newId('der')` mint + insert.
- **역해석 DAL** — `getDerivedStoreParent(store_id) -> { parentStoreId, artifactKind } | null`
  (인가에서 부모 찾기용).

## 3. ACL 상속 (H030/H050)

- der_ store는 **자기 membership이 없다.** `authorize()`가 der_ 경로를 만나면
  `derived_stores`로 **부모를 찾아 부모 멤버십으로 판정**한다(`policy.ts` 단일 지점 +
  `stores.ts:memberRole`). 인가 단위가 여전히 store 하나라는 H030 coarse ACL 유지.
- **read-only 키 규칙 계승:** 부모에 대한 write 권한이 있어야 der_에 push. 부모 read
  권한이면 der_ pull 가능.
- **teardown cascade:** 부모 owner teardown(`deleteStore` `stores.ts:214`) 시 그 부모의
  `derived_stores` 행을 함께 삭제하고 relay 로그 GC를 신호한다.

## 4. 와이어 계약 (docs/protocol)

- **discovery/mint 엔드포인트** — `GET /v1/account/personal-store`(get-or-create GET
  선례)의 형제:

  ```
  GET /v1/stores/:parentStoreId/derived/:artifactKind
    -> 200 { "storeId": "der_…" }        # get-or-create, 멱등
    인가: 부모 store 멤버(write 케이스는 non-read-only)
  ```

  GET이 create를 겸하는 것은 REST상 매끈하지 않으나 **기존 personal-store 선례와 일관**을
  택한다.
- **데이터평면 push/pull** — der_ id로 **동일 공개 edge + gateway 프록시 + relay 토큰
  주입**(`proxy.ts` handleEventsProxy). 별도 특권 경로를 만들지 않는다.
- PROTOCOL.md는 `docs/protocol/` 인덱스이므로, `docs/protocol/` 에 파생 store 절을
  추가하고 인덱스에서 링크한다.

## 5. relay · 페이로드 · E2E

- **relay 무변경.** der_는 여느 opaque per-store ndjson 로그다. dedup by `event.id`,
  순서 보존, append-only. relay는 der_라는 것도 모른다(제어평면 지식).
- **E2E (H070).** 벡터는 원문 텍스트만큼 민감하다(의미 누출). E2E opt-in 워크스페이스는
  벡터도 `{__enc:…}` 봉투로 싣는다 → 서버·미래 H060 replica는 그 워크스페이스 벡터를
  **못 읽는다**(기존 H070 "E2E는 서버 projection 포기" 규칙과 일관).
- **인코딩(클라 몫, 기록만).** 수십만 × 벡터라 JSON `number[]`(~20KB/1536dim)는 과하다 —
  float32 또는 양자화(int8) base64 권장. relay엔 여전히 opaque.

## 6. 첫 입주자: 임베딩 (self 케이스)

- **부모 = wsp_ (self는 1-멤버 private wsp_).** doctor가 보여준 canonical 바인딩이 곧
  부모다(예: `wsp_…`, SoT-031).
- **키잉:** 벡터 이벤트는 source 기억의 **raw `event.id`** 를 참조한다(로컬 consolidated
  entity id 아님). 모든 기기에서 안 변하는 union 키라 정확히 같은 행에 매칭된다.
- **모델 태그:** 이벤트가 `model id / version / dim` 을 싣는다. 소비 기기는 **자기
  임베딩 모델과 일치할 때만 재사용**, 불일치면 로컬 재임베딩. 태그 없으면 다른
  벡터공간 값이 섞여 ANN이 조용히 쓰레기를 뱉는다.
- **graceful degrade:** 벡터가 없거나 모델 불일치면 FTS-only로 동일 동작 퇴화
  (sibling `--union`이 이미 FTS-only) → **local-first 불변 유지, Hub는 절대 hard dep
  아님.**

## 7. 비목표 / 연기

- Hub에서 임베딩 **계산·색인·읽기**(H010/H060).
- foreign 워크스페이스 union semantic **reader** = memorize/H060 나중(sibling 베팅 존중).
- superseded 벡터 **retention/compaction** — append-only라 모델 교체 시 옛 벡터가 로그에
  잔존. 수십만 × 모델버전이면 팽창. 기존 Hub "Later" retention 항목으로 이월.
- 벡터 바이트 **쿼터/과금** — 기존 `usage_daily`(`usage.ts`) 확장으로 계량(경량, 옵션).

## 8. Cross-repo 의존 (memorize 레포 task)

Hub base는 클라이언트 소비자 없이는 pipe-to-nowhere다. self-벡터 첫 입주자를 살리려면
memorize 레포에 다음이 필요하다(§1 위임분):

1. 임베딩 DomainEvent kind 정의(schemaVersion) + author 경로.
2. projector가 그 kind를 embeddings 테이블로 insert; **모르는 kind는 fail-safe skip.**
3. der_ 사이드카 push/pull 배선(Hub 엔드포인트 소비).
4. 모델 매칭 재사용 / 불일치 재임베딩 + FTS graceful degrade.

→ Hub spec 커밋 후 cross-project delegation으로 memorize에 task 등록(§ 실행).

## 9. 단계 분할

- **S1 — gateway 프리미티브:** `der_` id + `derived_stores` 테이블/DAL + authorize
  부모위임 + discovery 엔드포인트 + 프록시 통과. 검증: der_로 push한 opaque 이벤트가
  다른 기기에서 pull됨(도메인 무관, 바이트 왕복).
- **S2 — 와이어 문서화:** `docs/protocol/` 파생 store 절 + PROTOCOL 인덱스 링크.
- **S3 — cross-repo task:** memorize 레포에 §8 클라이언트 작업 등록.
- **S4 — (연기) foreign reader / 서버 semantic:** H060 replica 착수 시 같은 프리미티브의
  두 번째 소비 경로로.

## 10. Cross-repo 조율 항목 (설계 불변 아님)

- **엔드포인트 경로 확정:** `GET /v1/stores/:parentStoreId/derived/:artifactKind`
  (§4). 이 문서에서 확정.
- `artifact_kind` 문자열 값(첫값 `'embedding'`)은 memorize 이벤트 kind 네임스페이스와
  **정렬**한다 — §8 cross-repo task에서 양쪽 동시 못박음(Hub 단독 결정 아님).
