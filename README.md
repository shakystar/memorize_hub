# memorize_hub — Memorize의 선택적 동기화·협업 서버

**개발 종료 · MIT 라이선스 · 구현·검증 기록 보존**

[memorize](https://github.com/shakystar/memorize)가 로컬에 쌓은 기억 이벤트를 기기와 워크스페이스 사이에서 공유하도록 만든 서버다. 전송 계층과 계정·권한 계층을 분리하고, 별도의 replica와 웹 화면으로 읽기·작성 기능을 확장했다. Memorize의 로컬 기능을 사용하기 위해 Hub가 반드시 필요한 것은 아니다.

## 수상 프로젝트와의 관계 및 종료 경위

**Memorize는 2026 공군창업경진대회 우수상 수상 프로젝트**다. 작성자 기록상 예선은 v1.0.0, 결선은 v3.0.0으로 출품했다. 이 저장소는 Memorize와 연결해 사용한 후속 동기화·협업 구성 요소이며, Hub 자체가 별도로 수상했다거나 현재 main의 모든 기능이 대회 당시 구현됐다고 주장하지 않는다.

Memorize와 Hub를 개발·사용하며 생긴 질문은 [mori](https://github.com/shakystar/mori)·[mori-nest](https://github.com/shakystar/mori-nest)의 에이전트 실행·협업 실험으로 이어졌다. 군 복무 중 확보 가능한 시간, 모델 API와 반복 평가 비용, 관련 도구의 등장을 고려해 이 프로젝트군의 추가 개발·유지보수를 종료한다.

신규 기능, 정기 유지보수, 보안 업데이트를 계획하지 않는다. 과거 배포 도메인은 운영 기록이며 현재 서비스 제공을 약속하지 않는다. 자세한 구현 근거와 한계는 [최종 상태](./docs/final-status.md)에 기록했다.

## 실제 구성

| 경로 | 역할 | 상태 |
| --- | --- | --- |
| `packages/relay` | `node:http` 기반 이벤트 저장·전달, NDJSON, ID 중복 제거·순서 보존 | 구현·테스트 있음. 계정이나 기억 의미를 해석하지 않음 |
| `packages/gateway` | 계정·키·Google OAuth·기기 로그인, 워크스페이스·멤버·초대·권한, 개인 저장소, relay 프록시 | 현재 제어 계층. SQLite에 계정·권한 정보를 저장 |
| `packages/replica` | 배포된 Memorize 엔진을 이용한 읽기·작성, 작업·타임라인 처리 | `@shakystar/memorize@3.0.0-dev.68`에 고정된 구현 |
| `packages/web` | React·Vite 기반 워크스페이스, 연결·공유·작업·타임라인 화면 | 화면·관련 테스트 있음 |
| `packages/gateway-legacy` | 재설계 이전 gateway | 참고용으로 보존. pnpm workspace와 현재 검증에서 제외 |

relay는 이벤트를 저장·전달하고, gateway는 접근을 통제한다. 기억의 projection·해석은 클라이언트 또는 replica의 역할이다. 이 분리를 제품 전체가 완성됐다는 의미로 해석하지 않는다.

## 검증 기록과 한계

- 기준 커밋 `463aa48244683c4bd7e195ebef26764336044ad2`의 [CI](https://github.com/shakystar/memorize_hub/actions/runs/29631031536)는 성공했다. 상세 작업 범위는 [최종 상태](./docs/final-status.md)에 기록한다.
- **실제 물리 기기 두 대의 동기화를 테스트했고, 작성자와 팀원이 실제로 사용했다.** 이 내용은 작성자가 2026-09-24 최종 정리 과정에서 확인한 실사용 기록이다.
- 별도로 [2026-06-27 실측](./sandbox/RESULTS.md)은 배포 Hub와 두 Docker 컨테이너의 `memorize@2.4.0` 사이에서 양방향 이벤트 집합의 일치를 확인한 기록이다. 아래 지연 수치는 이 컨테이너 실험에서 나온 값이며 물리 기기 실사용의 측정치와 구분한다.
- 해당 실측의 push+pull 5회 평균은 **5,472ms**였다. CLI 시작과 서버 기동을 포함한 전체 소요 시간이며 relay 처리 지연만 측정한 것이 아니다.
- 보존·압축 정책, 서버의 이벤트 알림 채널, 과금·할당량, 암호화 키 배포·복구 같은 항목은 설계·미완료 범위로 남아 있다. 대규모·장기 운영의 안정성을 입증한 결과는 없다.

## 로컬 재현

Node.js 22 이상과 pnpm 10.30.3을 사용한다. 당시 CI는 Node.js 24를 사용했다.

```sh
pnpm install --frozen-lockfile
pnpm -r check
pnpm -r build
node scripts/start-hub.mjs
```

OAuth·세션·내부 relay 인증 설정은 [배포 문서](./docs/DEPLOY.md)를 따른다. 기존 도메인과 Fly 앱 이름은 과거 운영 예시이며 본인 설정으로 바꿔야 한다. 실제 운영 데이터·자격증명은 저장소의 재현 자료가 아니다.

## 문서

- [최종 구현·검증 상태](./docs/final-status.md)
- [HTTP 계약](./PROTOCOL.md), [계약 상세](./docs/protocol/README.md)
- [설계 결정](./docs/SoT/README.md), [설계 방향·불변식](./AGENTS.md)
- [워크스페이스 계약](./docs/WORKSPACE_CONTRACT_BRIEF.md), [합류·병합 설계](./docs/JOIN_AND_MERGE.md)
- [동기화 실험 도구](./sandbox/README.md), [보안 유지보수 상태](./SECURITY.md)

과거 설계 문서의 ‘예정’·‘운영 중’ 표현은 작성 당시 기록이다. 종료 상태와 실제 구현 판단은 최종 상태 문서를 우선한다.

## 라이선스

2026-09-24 최종 정리부터 현재 소스를 **[MIT 라이선스](./LICENSE.md)**로 공개한다. 기존 Sustainable Use License 안내를 대체한다. 외부 의존성과 포함된 제3자 구성 요소는 각자의 라이선스를 따른다. 이전 버전의 고지는 해당 버전에 보존한다.
