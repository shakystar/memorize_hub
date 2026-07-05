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
