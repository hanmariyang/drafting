# Changelog

시맨틱 버저닝을 따릅니다. 최신이 위.

## 1.6.8

- MCP: `drafting-add-item` accepts priority, pageType, section, links
  (reqs/features/pages) and stepPage — MCP-authored projects can now pass
  compile lint (#94). New `drafting-list-reqs` for valid requirement refs.
- Item generation now includes parent plan items as context from chain step 2,
  and links must use refs (F-nn/PG-nn), not prose titles (#93).

## 1.6.7

- MCP: structure documents (feature-spec, IA, user-flow) now reject prose
  sections — items are the canonical content. Prose stays for prd/handoff.
- MCP: `handoff` document type (dev handoff spec) can be created directly.

## 1.6.6

- MCP: `drafting-add-item` / `drafting-list-items` — structure documents
  (feature-spec, IA, user-flow) are now authored as real plan items with
  server-assigned refs (F-01…), so compile lint checks real content.
- MCP-authored documents are promoted like app-authored ones
  (draft → ready, version >= 1) once content lands (#92 follow-up).

## 1.6.5

- Fix: structure-type documents authored as prose sections (external MCP writers)
  now open in the section editor instead of an empty structure view (#91).
- New: window-focus refetch — documents written by external processes (e.g.
  Grouping) appear without restarting the app (#92).
- MCP: `drafting-export-project` — whole-chain markdown bundle; non-PRD documents
  now require `parentDocumentId` (document-chain enforcement, 1.6.4).

## 1.6.4

- **fix(nav): 같은 타입 문서를 전부 표시** (#88) — 프로젝트에 동일 `type` 문서가 2개 이상일 때
  사이드바가 `type` 을 키로 쓰는 맵으로 렌더해 첫 문서만 남고 나머지가 사라지던 문제.
  대표 문서(체인) 외의 나머지를 "기타 문서" 그룹으로 전부 표시한다. DB·API 는 정상이었고
  프론트 표시 단계만 수정.
- **fix(mcp): 문서 체인 강제** — PRD 가 아닌 문서를 만들 때 `parentDocumentId` 를 요구한다.
  에이전트가 인터뷰 → PRD → 기능명세 → IA → 유저플로우 파생 체인을 건너뛰고 형제 문서를
  한 번에 만들던 것을 막아, MCP 로 만든 문서도 부모→자식 체인에 정확히 편입되게 함.

## 1.6.3

- MCP server (stdio): `npm run mcp` — 8 tools for agent access (projects, documents,
  sections, compile lint report, markdown export). Bundled in the desktop app
  (`Resources/daemon/api/dist/mcp.js`), same DATABASE_PATH as the app.

## 1.6.2

- **npm 자동 배포 활성** — 태그 시 릴리스 CI 가 `@hanmariyang/drafting` 를 npm 에 publish.
  이제 `npx @hanmariyang/drafting serve` 로 설치 없이 터미널에서 바로 실행(구독·env BYOK 둘 다).

## 1.6.0

- **터미널 모드 (`drafting serve`) + env-var BYOK** — 구독·BYOK 셋업 문제를 한 번에 푸는 실행 방식.
  서버를 터미널에서 띄우면 "터미널 프로세스" 컨텍스트로 돌아: **구독(CLI)**은 이 터미널의 claude 키체인/PATH 를 그대로
  써서 GUI 앱의 키체인 거부를 우회하고, **BYOK**는 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`(+`OPENAI_BASE_URL`)/
  `OPENROUTER_API_KEY`/`LITELLM_API_KEY` 를 마법사 없이 인식한다(dev 도구처럼).
  - `bin/drafting.mjs`(package.json bin) — 데몬 기동 + 브라우저 오픈, APP_ENCRYPTION_KEY 자동 생성·보관.
  - 키 해석에 env 폴백(getDecryptedKey/getKeyMeta/listKeyMeta) — env 키도 keysConfigured 에 잡힘.
  - 실측: 터미널 서버로 구독(CLI) 21KB · env BYOK 7KB 시안 생성 성공. 설계 Docs/spec/terminal-mode-spec.md.

## 1.5.1

- **구독(CLI) 실패 안내 개선** — 빨간 원문만 뜨던 것을 "왜 안 되는지 + 무엇을 하라"로. 원인별(미설치·로그인/키체인·조직차단·타임아웃)
  안내 + "API 키(BYOK)로 전환" 버튼 + 원문 접기. 설정·온보딩 공용(cliHelp).
- **OpenRouter 모델 목록** — 표준 OpenRouter(BYOK)일 때 사용 가능한 모델을 못 보던 문제. 공개 /models(419개)를
  불러와 모델 칸 자동완성으로. 게이트웨이 모델과 합쳐 표시.

## 1.5.0

- **디자인 시스템 스키마 대폭 확장** — 결과가 담기던 "그릇"이 6개 값(accent·mode·density·font·radius·rationale)뿐이던
  구조적 한계를 해소. 이제 인터뷰 답변이 풍부한 DesignSystem 으로 담긴다:
  - **상태색** success/warning/danger/info (색 역할 체계와 별도). "빨강 회피" 답변 시 danger 를 앰버로 자동 대체.
  - **타입 스케일**(display/title/body/caption px) + **여백 체계**(4px 그리드 스케일) — 밀도에서 파생.
  - **접근성을 실제 필드로** — highContrast/colorblindSafe/notes. 고대비면 ink·경계 대비 강화, 색맹 안전이면 상태를 색+글리프로.
  - **라이트 + 다크 세트 동시** — 둘 다 요구 시 두 팔레트를 함께 보관/미리보기.
  - **스타일 타일 확장** — 상태 배지(색+글리프)·다크 세트 스트립·타입 스케일·여백 바·미디어/시안 그리드(여러 안 비교)·확장 컴포넌트.
  - 파생 StyleGuide 로 와이어프레임·시안(B/A)은 그대로 구동(하위호환). "산세리프→serif" 오탐 수정.

## 1.4.0

- **디자인 시스템 방향 탐색 (P2)** — 인터뷰 답변에서 3가지 방향안(균형·부드러움·선명함)을 생성해
  스타일 타일로 나란히 비교, 하나를 고르면 제안으로 확정. 강조색은 유지하고 성격(서체·밀도·라운드·표면)만 다르게.
  결과 뷰에서 "다른 방향 보기"로 재탐색. 디자인 탐색을 제안 문법 안에서.

## 1.3.0

- **프로젝트 완전 내보내기·가져오기 (스냅샷 이동)** — 프로젝트 전체 상태(문서 체인·섹션·항목·인터뷰·제안·이력·
  시안·StyleGuide·디자인 시스템)를 한 `.drafting` 파일로 export, 새 프로젝트로 import(ID 전량 재매핑, 라운드트립 1:1).
  계정·서버 없이 다른 기기로 작업을 통째로 이어갈 수 있다. ⚠️ BYOK 키·공유링크 토큰은 제외(시크릿 유출 방지).
  허브에 "내보내기", 시작 화면에 "가져오기". 실측 라운드트립 검증(4 docs/35 items/6 화면 완전 복원).

## 1.2.0

- **디자인 시스템 인터뷰 (마일스톤)** — 시안의 목적을 "컴포넌트 그리기"에서 "제품의 디자인 시스템 설계"로.
  신규 `design-system` 문서 타입(체인: …→유저플로우→디자인 시스템→와이어프레임/시안).
  - 인터뷰 7문(성격·레퍼런스·맥락·색·타이포·형태·접근성) → AI 가 **DesignSystem 토큰 + 설계 근거**를 제안(제안→수락).
  - **스타일 타일 프리뷰**: 색 역할 스와치·타입 스펙·컴포넌트 샘플을 토큰에서 결정적으로 렌더.
  - 수락하면 프로젝트 StyleGuide 로 반영 → 와이어프레임·시안이 이 시스템으로 렌더. 프리셋=시드 유지.
  - AI_STUB/오프라인은 답변 키워드 결정적 매핑. 설계: Docs/spec/design-system-interview-spec.md.

## 1.1.2

- **무거운 화면 AI 시안 생성 실패 수정** — 기능 많은 화면은 시안 HTML 이 길어 토큰 소진으로 잘리던 문제.
  시안 전용 maxTokens 16k 상향 + 미완성(닫는 </html> 없음) 감지 시 1회 자동 재시도.
- **HTML 추출 버그 2건 수정** — 모델이 서두 텍스트를 붙이면 (1) 시작 마커를 max 로 잡아 <!doctype> 을 버리거나
  (2) slice 후 stale 인덱스로 끝이 어긋나던 것. 이제 가장 이른 마커부터 + 인덱스 재계산.

## 1.1.1

- **시안 생성 실패가 조용히 무반응이던 것 수정** — 생성 요청이 실패해도 아무것도 안 뜨던 문제(catch 누락).
  이제 실패 원인(인증·모델 접근·OAuth 만료 등)과 조치 안내를 카드에 표시하고, 생성 중 상태도 명확히.
- **게이트웨이 기본 모델** — OpenAI 호환 게이트웨이(LiteLLM 등)를 설정하면 모델 미지정 시 하드코딩된 `claude-*`
  대신 **그 게이트웨이가 제공하는 첫 모델**을 기본값으로. (게이트웨이 키가 claude 에 접근 못 해 거부되던 전형 방지.)
  엔드포인트 저장·새로고침 시 게이트웨이 모델 목록을 보관. 실 게이트웨이로 생성 성공 실측.

## 1.1.0

- **와이어프레임 → 시안 고도화 (테마 + AI 시안)** — "완료 후 시안 보고 구현 결정" 흐름을 위해
  저해상도 골격 와이어프레임을 넘어 디자인된 시안까지. 프로젝트 **StyleGuide(테마)** 하나로 묶는다.
  - **테마(C)** — 프리셋 5종(Clean·Warm·Mono·Vivid·Dark) + 강조색·밀도 조절. 와이어프레임·시안 공용.
  - **테마 적용 와이어프레임(B)** — 결정적 렌더가 테마를 입어(액센트·표면·라운드·서체·간격) 고해상도로. AI·비용 0 유지.
  - **AI 시안(A)** — 화면별 옵트인. 페이지 콘텐츠+테마로 자기완결 HTML 화면을 생성해 샌드박스 iframe 에 표시,
    제안 문법(수락/재생성/삭제). `AI_STUB` 은 테마 반영 결정적 HTML. 기본은 무료 와이어프레임, 시안은 명시 옵트인.
  - 실 LLM 로 vivid 테마 대시보드 시안 생성 실측(도메인 콘텐츠·차트·표·CTA). 설계 `Docs/spec/wireframe-mockup-spec.md`.

## 1.0.5

- **계층 사이트맵(섹션 > 페이지 트리)** — 평면 카드 그리드에 더해, 화면을 **섹션으로 묶어
  APP 루트 아래 트리**로 렌더. 관련 화면끼리 그룹이 보여 진짜 사이트맵이 된다.
  - 생성이 각 화면에 `section` 을 부여(관련 화면끼리 묶음), 인스펙터에서 섹션 이동·새 섹션 생성.
  - 섹션이 없는 기존 문서는 기존 평면 그리드로 그대로(하위호환), 일부만 있으면 나머지는 "미분류".

## 1.0.4

- **정보 구조(IA) 뷰 개편** — 노드를 평면에 흩뿌리던 사이트맵을 관계·완결성이 보이는 뷰로.
  - **완결성 헤더** — 화면 수·검사 위반·도달 없음·기능 배치 비율을 세부보다 먼저 요약.
  - **타입 인지 카드** — 모든 화면이 같던 가짜 스켈레톤을 `page_type`별 미니 레이아웃 글리프
    (LIST·DETAIL·FORM·DASH·SETTINGS)로 교체해 화면 성격을 한눈에.
  - **사이드/하단 인스펙터** — 선택한 화면의 근거 기능·진입 플로우·상태를 그 자리에서 편집.
  - **커버리지 탭** — 기능 × 화면 격자로 미배치 기능(화면 없음)·빈 화면을 즉시 파악.
  - 문서 폭에 맞춘 반응형(카드 다열 그리드 + 전폭 인스펙터), 상태색은 제안 그린/앰버 위반색 유지.

## 1.0.3

- **구조 워크스페이스 카드(.scard) 제목 깨짐 수정** — 1.0.2 는 우측 제안 패널만 고쳤고,
  정보 구조(IA)·기능명세 워크스페이스의 제안 카드는 여전히 긴 근거 라벨에 제목이 세로로 눌렸다.
  같은 견고 패턴(근거를 제목 아래 자기 줄로 + 어절 단위 줄바꿈 + `overflow-wrap:anywhere`)을 적용해
  **내용 길이·형태와 무관하게** 세로 깨짐·가로 넘침이 없도록 함(공백 없는 초장문도 카드 안에서 감쌈).

## 1.0.2

- **제안 카드 제목 깨짐 수정** — 긴 근거 라벨에 밀려 제목이 한 글자 폭으로 눌려 세로로
  쌓이던 문제. 근거를 제목 아래 자기 줄로 내려 가로 경쟁을 없애고, 제목은 어절 단위로만 줄바꿈.
- **CLI 생성 에러 원인 노출** — "agent CLI returned an error" 만 뜨던 것을, CLI stderr 꼬리를
  덧붙여 실제 원인(과부하·레이트리밋·모델 오류 등)이 보이게.
- **확장 사고 스톨 방지** — CLI 한 방 생성(정보 구조 등 엄격 JSON 포함)에서 extended thinking 이
  스톨/토큰 소진으로 빈 결과·오류를 내던 것을 `MAX_THINKING_TOKENS=0` 기본값으로 차단(명시 설정 시 존중).

## 1.0.1

- **CLI 자동 탐색 강화** — nvm·fnm·asdf·n·volta 등 노드 버전 매니저가 심는 `claude` 를 직접
  탐색(여러 버전이면 최신 우선). GUI 앱이 셸 PATH 를 못 물려받아 "설치했는데 못 찾음" 되던 문제 해결.
- **스폰 PATH 주입** — 찾은 바이너리와 같은 dir(그 안의 node)을 PATH 앞에 얹어, nvm 등의
  node 래퍼(`#!/usr/bin/env node`)가 node 를 못 찾아 실패하던 케이스를 해결.
- **CLI 경로 수동 지정** — 설정 > AI 엔진에 claude 전체 경로 직접 입력 필드(자동 탐색이 실패하는
  비표준 설치용 escape hatch). 감지된 경로도 함께 표시.

## 1.0.0

첫 안정 릴리스. 인터뷰 → PRD·기능명세·IA·유저플로우 → 핸드오프의 전 흐름이 구독·BYOK·
OpenAI 호환 게이트웨이 어디서나 동작하고, 산출물을 실무로 바로 내보낼 수 있다.

- 안정성: provider 에러 표준화, 추론형 모델 대응(토큰 예산·"생각 중"), 생성 중지, 워크스페이스 백업/복원.
- 문서 체인: 링크 위반 4종을 UI 로 근본 해소(기능↔요구·화면↔기능·기능↔플로우·스텝↔화면), 프로젝트 허브(다음 할 일).
- 산출물: PDF·개발 티켓 내보내기, 에이전트 실행형 핸드오프 프롬프트 팩, 인앱 템플릿 라이브러리.
- 에디터: 섹션 재정렬·되돌리기, 명령 팔레트, 완료 세리머니.
- 배포: 3-OS 서명 인스톨러 + 자동 업데이트, GHCR 서버 이미지(`docker pull`), 온보딩 3경로 통합.
- 보안: same-origin CORS 기본, `.dockerignore`, BYOK AES-256-GCM, PR CI, SECURITY/CONTRIBUTING.

## 0.9.x — 패키징·배포 + 1.0 전 하드닝
- 0.9.2: **보안** — CORS same-origin 기본(CSRF·유출 방지), `.dockerignore`, PR 테스트 CI, CONTRIBUTING·SECURITY.
- 0.9.1: 온보딩에 게이트웨이 경로 통합(구독·BYOK·게이트웨이 3경로).
- 0.9.0: GHCR 서버 이미지 배포(`ghcr.io/hanmariyang/drafting`), 자동 업데이트 확인.

## 0.8.x — 에디터·생산성
- 0.8.2: 완료 세리머니 + 빈 상태 폴리시(모션 마감).
- 0.8.1: 되돌리기(undo).
- 0.8.0: 섹션 재정렬(↑/↓), 명령 팔레트 템플릿 액션.

## 0.7.x — 산출물·핸드오프
- 0.7.2: 에이전트 실행형 핸드오프 프롬프트 팩.
- 0.7.1: 인앱 템플릿 라이브러리(파일 위 DB 오버레이).
- 0.7.0: PDF·개발 티켓 내보내기.

## 0.6.x — 문서 체인 완성도
- 0.6.2: 스텝→화면 편집(W-UNREACHED-PAGE), IA "도달 플로우" 표시 버그 수정.
- 0.6.1: 프로젝트 허브(다음 할 일·상태 배지) + 디자인 정합 점검.
- 0.6.0: 링크 편집기 일반화(기능→요구, 화면→기능).

## 0.5.x — 안정화
- 0.5.2: 워크스페이스 백업/복원.
- 0.5.1: 스트리밍 "생각 중" + 생성 중지.
- 0.5.0: provider 에러 표준화, 추론형 모델 토큰 예산.

## 0.4.x — 실사용 버그픽스 러시
- 카드 레이아웃·고쳐쓰기·정합성 "모두 수락" 통삭제, 조직 계정 Claude Code 차단 대응,
  구조 문서 내보내기 빈칸, OpenAI 호환 게이트웨이 base URL(자동 /v1 감지·모델 드롭다운),
  버전 표기(config.readVersion) 등.

## 0.1.0 — 첫 공개
- 셀프호스트 AI 기획 도구. 인터뷰→문서 체인, 제안 수락 문법, SSE, BYOK, 만료형 공유,
  데스크톱 앱 + 랜딩 + 3-OS 릴리스 CI.
