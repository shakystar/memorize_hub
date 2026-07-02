# 게이트웨이 웹 UX - 앱셸(워크스페이스 우선) 플랜

> 상태: DRAFT / 플랜(구현 전). 이전의 "설정 페이지 정리" 버전과 "서버-HTML 유지" 결정을
> **폐기**한다. 근거: Hub SoT(무엇이 1급인가, read surface 위치) + 공식 ChatGPT 앱셸
> 직접 분석(chatgpt.com, help.openai.com "Projects in ChatGPT") + OpenAI cookbook 스택.
> memorize SoT/Hub SoT를 지키는 선에서 편의 기능은 개발이 제안·추가할 수 있다(예상을
> 크게 벗어나지 않는 한).

## 0. 스택 결정 (2026-07-01 확정)

- 인증된 앱셸은 **Vite + React + TypeScript + Tailwind v4 + shadcn/ui + Lucide** 정적 SPA.
- gateway가 그 정적 번들 + JSON API를 서빙하고, SPA는 **세션 쿠키**로 API를 호출한다.
- 서버-HTML 유지: 공개/단순 흐름(랜딩 `/`, `/docs`, `/join`, `/oauth/callback`)은 그대로.
- Next가 아니라 Vite인 이유: 우리는 백엔드(gateway)가 이미 있고 앱이 로그인 뒤 대시보드라
  SSR/SEO 이득이 없다. Next의 서버 절반은 2번째 서버가 되어 control-plane을 복잡하게 한다.

## 1. SoT가 정한 실제 구조

- **1급 객체 = store/workspace(`wsp_`).** 제어평면은 workspace-중심 통일, private 프로젝트
  = 1-멤버 워크스페이스. 계정/키/개인스토어는 **받치는** 계정-scope 객체 (H040, H050).
- **gateway는 control-plane 전용.** 인증·coarse 인가·opaque 로그 프록시만. projection/query/
  랭킹/도메인 렌더 금지 → 메모리 뷰를 gateway에 넣으면 2-plane 위반 (H010, H030).
- **메모리 read/write surface**(워크스페이스 기억 브라우즈·쿼리·UI에서 기억 추가) =
  **relay를 소비하는 별도 headless memorize replica**, 연기·trigger-gated. 트리거 중 하나가
  "브라우저 워크스페이스 UI 수요" (H060, H900).

귀결: 웹앱 = **셸 + auth 프레임**. 메인 캔버스는 그 replica가 채울 자리이며 **지금은 예약
placeholder**. React SPA는 gateway control-plane JSON API의 클라이언트일 뿐이라 평면 경계를
안 건드리고, 오히려 미래 read surface를 끼워넣기 쉽다.

## 2. 공식 ChatGPT 셸 (직접 분석)

chatgpt.com + help.openai.com "Projects in ChatGPT" 기준:

- 좌측 사이드바: 상단 브랜드+접기 → 링크/도구군(새채팅·검색·이미지·앱·리서치) →
  **중앙 프로젝트+recents** → 하단군(플랜·설정·도움말) → **최하단 계정**.
- 메인: 상단 컨텍스트 스위처 + 중앙 작업면.
- **프로젝트 = "smart workspace"**: 사이드바에서 New project로 생성, name+icon+color,
  안에 chats/files/instructions/memory. **공유·설정**(초대·링크·access control·leave·delete)은
  "..." 뒤의 2차 기능.

## 3. 목표 IA (앱셸)

```
+---------------------+------------------------------------------------+
| memorize Hub    [<] |  <workspace name>          [members]  [설정]   |
|---------------------|                                                |
|  Docs               |   +-----------------------------------------+  |
|  GitHub             |   |                                         |  |
|---------------------|   |   워크스페이스 메모리 (read/write surface) |  |
|  WORKSPACES     [+] |   |   개발 예정 - headless replica (H060)     |  |
|  # my-notes         |   |   지금은 비움 + sync 방법 안내만          |  |
|  # team-notes     <-|   |                                         |  |
|  # design           |   +-----------------------------------------+  |
|      (빈 공간)       |                                                |
|---------------------|                                                |
| (avatar) @you       |   계정 = personal settings 진입                 |
+---------------------+------------------------------------------------+
```

- **사이드바 상단 링크군**: Docs, GitHub 등 **실존 링크만**. (지어낸 codex 류 금지. 새 링크는
  붙을 때 추가.)
- **사이드바 중앙(주 spine)**: `WORKSPACES` 헤더 + `[+]` New, 그 아래 워크스페이스 리스트
  (각 `wsp_`, 이름 표시, 선택 강조). private(1-멤버)·shared 모두 여기. New는 이 섹션 헤더
  옆이지 Docs 위가 아니다.
- **사이드바 최하단**: **계정** 아바타 → personal settings(API 키, 개인 메모리, 로그아웃).
  계정은 구석이지 중심이 아니다.
- **메인 상단바**: 선택된 워크스페이스 이름 + 멤버 요약 + **[설정]**(workspace settings 진입).
- **메인 캔버스**: **read/write surface 자리 예약(H060)**. replica 나오기 전엔 **비움 +
  "개발 예정" 명시 + sync 퀵스타트**만. gateway에 메모리 뷰를 직접 넣지 않는다.

## 4. personal settings ≠ workspace settings (둘 다 큰 영역)

- **personal settings**(하단 계정): API 키 발급/목록/폐기·scope, 개인 메모리 id, 로그아웃.
  계정 단위. (D1/D2 계정 콘텐츠가 여기로 재배치.)
- **workspace settings**(워크스페이스 상단바 [설정]): 워크스페이스 단위. 지금 실제로 있는 건
  **members / invites / roles / leave / delete**(D2 재배치). 그 외는 **개발 예정 라벨만**:
  워크스페이스 이름/아이콘/색, opt-out publish 정책(H900), retention, (그리고 SoT 준수하는
  편의 기능들). 억지로 채우지 않는다 - 비우거나 "개발 예정".

## 5. "안 만드는 건 비우거나 개발 예정" 원칙

not-yet 기능은 밀도 있게 채우지 않는다. 메인 캔버스(read surface), workspace settings의
미구현 항목, 붙지 않은 링크 = **빈 상태 또는 "개발 예정" 배지**. 이는 정직한 프레임이자
미래 자리 예약이다.

## 6. 남는 것 / 바뀌는 것

- **그대로**: relay 전부; gateway의 API/DAL/auth/session/oauth/policy(검증된 코어)와 33개
  테스트; 서버-HTML 랜딩·docs·/join·/oauth.
- **바뀜**: 인증된 앱셸(`/account`+워크스페이스)이 React SPA로. D1/D2 서버-렌더 HTML 뷰
  폐기(DAL/API 재사용). 계정 액션 일부를 세션-JSON 엔드포인트로 노출(대부분 `/v1/*`에 이미
  있음; account keys/personal은 추가).
- **추가**: 프론트 패키지 `packages/web`(Vite SPA) + Docker SPA 빌드 스텝 + gateway 정적 서빙.

## 7. 단계 (개정)

- **R1 - 앱셸 프레임 + 프론트 스택**: `packages/web` 스캐폴딩(Vite/React/TS/Tailwind/shadcn),
  gateway가 SPA 서빙 + 세션-JSON 인증 배선. 지속 사이드바(상단 링크 / 워크스페이스 리스트 /
  하단 계정) + 메인(워크스페이스 상단바 + 예약 캔버스 placeholder). 새 백엔드 로직 0.
- **R2 - 워크스페이스 메인뷰 + settings + personal settings**: 캔버스 placeholder(sync
  퀵스타트) + [설정] 패널에 D2 콘텐츠(members/invites/roles/leave/delete) 기존 API로,
  미구현은 "개발 예정". 계정 메뉴에 personal settings(키/개인메모리).
- **R3 - 연기·gated**: headless replica read/write surface가 캔버스를 채움(H060/H900),
  워크스페이스 이름/아이콘/색, rename API, opt-out 정책, `/admin`. 캔버스에 무엇이
  들어가는지(타깃 사용자·탭·authoring 단계)는 `workspace-canvas-features.md`가 정한다.

## 8. 착수 전 확인이 필요한 것

- "배포 전 필수 개발 항목"의 구체 목록(사용자 제공) → 그것만 실제로 만들고 나머지는
  비움/개발예정. R1/R2 범위를 그 목록으로 확정한다.
