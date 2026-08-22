# Drafting — AI 기획 워크스페이스

> IT 기획자·PM이 **단계별 AI 인터뷰**로 PRD·기능명세서 같은 기획 문서를 빠르게 완성하는
> **셀프호스팅 오픈소스** 도구. 자신의 AI 키를 연결(BYOK)해 로컬/서버에 설치하고, 결과물을
> MD·HTML로 팀·클라이언트와 공유한다.

**AI는 제안을 쓰고, 문서는 당신이 씁니다.** 마스코트 **초안이**(제안을 물어오는 초안 종이)가 첫 실행·빈 상태·에러에서 안내합니다. AI가 쓴 모든 문장은 제안(그린 하이라이트)으로 들어오고, 수락해야만 문서가 됩니다. 랜딩: [hanmariyang.github.io/drafting](https://hanmariyang.github.io/drafting)

---

## 무엇을 하나

1. **AI 인터뷰** — 문서 유형별 질문(힌트·예시 포함)에 답하면
2. **스트리밍 초안** — AI가 섹션 단위로 초안을 실시간 생성하고, **완료된 섹션은 즉시 편집 가능**
3. **구조 편집기** — 분할 미리보기·드래그 재정렬·자동 저장·버전 히스토리
4. **내보내기** — Markdown 다운로드 / 읽기 전용 HTML 공유 링크(만료 설정 가능)
5. **엔진 2모드** — 기본은 **Claude Code(구독)**: 로컬 CLI 를 데몬처럼 구동해 **API 키가 필요 없다**
   (데스크톱 앱·호스트 셀프호스트). CLI 가 없는 docker 환경은 **BYOK**(Anthropic·OpenAI·OpenRouter 키,
   암호화 저장) 폴백. 설정에서 언제든 전환.

문서는 **체인**을 이룬다: `PRD → 기능명세 → IA → 유저플로우`. 하위 문서는 상위 컨텍스트를
승계하며, 상위가 바뀌면 하위에 **"컨텍스트 갱신 필요"** 배지가 뜬다 — 단, **자동으로 덮어쓰지
않는다**(사용자 명시 승인).

---

## 빠른 시작 — Docker (권장, 원클릭)

빌드 없이 배포된 이미지로 바로 실행:

```bash
docker run -p 8477:8080 -v drafting:/data ghcr.io/hanmariyang/drafting:latest
# → http://localhost:8477 접속
```

또는 소스에서 빌드:

```bash
cp .env.example .env          # (선택) 값 조정
docker compose up --build     # 빌드 후 기동
# → http://localhost:8477 접속
```

첫 접속 시 설정 위저드가 뜬다. **Claude Code CLI 가 감지되면 키 없이 바로 시작**, 아니면 BYOK 키 1개 등록.

> **조직 계정이라면**: 회사·조직 계정으로 로그인된 Claude Code 는 조직이 구독 접근을 막아둔 경우
> 생성이 거부된다(`disabled Claude subscription access for Claude Code`). '키 없이 시작' 을 누르면
> 앱이 실제 생성 권한을 먼저 확인하고, 막혀 있으면 **BYOK 키 등록** 화면으로 안내한다.
> 이 경우 개인 구독 계정으로 CLI 를 다시 로그인(`claude /login`)하거나, Anthropic/OpenRouter API 키를 등록하면 된다.

> **OpenAI 호환 게이트웨이(LiteLLM·Azure·사내 프록시)를 쓰려면**: 설정 화면의
> **"OpenAI 호환 게이트웨이"** 에 base URL 을 넣거나(예: `https://gateway.example.com/v1`),
> 환경변수 `OPENAI_BASE_URL`(또는 `LITELLM_BASE_URL`)을 설정한다. 그다음 **openai** 키 칸에
> 게이트웨이 키를 등록하고, 모델 설정에 게이트웨이가 제공하는 모델 id 를 지정하면 된다.
> 게이트웨이 주소·키는 설정/환경에만 두며 저장소 코드에는 넣지 않는다.

> **키 없이 데모만 보고 싶다면**: `.env`에 `AI_STUB=1`을 설정하고 `docker compose up`.
> 오프라인 스텁 AI가 결정적 초안을 생성하므로 전체 흐름을 키 없이 체험할 수 있다.

포트를 바꾸려면 `.env`의 `DRAFTING_PORT`를 조정한다.

---

## 로컬 개발 (Docker 없이)

요구: **Node ≥ 22** (권장 24/26 — 내장 `node:sqlite` 사용, 네이티브 컴파일 없음).

```bash
npm install          # 루트에서 (api + web 워크스페이스 동시 설치)
npm run dev          # api(:8080) + web(:5173) 동시 기동
# → http://localhost:5173  (vite가 /api·/s 를 :8080 으로 프록시)
```

개별 실행:

```bash
npm run dev:api      # Fastify API (tsx/watch) :8080
npm run dev:web      # Vite dev server :5173
```

테스트:

```bash
npm test             # api 유닛/통합 테스트 (node:test, 스텁 AI)
```

프로덕션 빌드:

```bash
npm run build        # web → web/dist, api → api/dist
npm start            # node api/dist/index.js (api가 web/dist 정적 서빙)
```

---

## 구조

```
.
├── api/                 # Fastify + node:sqlite 백엔드 (TypeScript, ESM)
│   ├── src/
│   │   ├── index.ts     # 서버 부트스트랩 (SPA 정적 서빙 포함)
│   │   ├── db/          # 스키마 적용 + 리포지토리 (Project·Document·Section·InterviewSession …)
│   │   ├── lib/         # config · crypto(BYOK 암호화) · templates · ai(스트리밍 오케스트레이션) · render
│   │   ├── providers/   # AI 추상 레이어 (§ 아키텍처)
│   │   └── routes/      # projects · documents · interview · keys · settings · share
│   ├── templates/       # 인터뷰 템플릿 JSON (외부 파일 — 하드코딩 아님)
│   └── test/            # node:test 스위트
├── web/                 # Vite + React SPA (단일 워크스페이스 화면)
│   └── src/
│       ├── pages/       # StartScreen · ProjectView · DocumentWorkspace · Settings
│       └── components/  # InterviewPanel · SectionCanvas · Onboarding · Version/Share/Context 모달
├── db/schema.sql        # SQLite 스키마 (부팅 시 idempotent 적용)
├── docs/spec/           # 선결 과제 설계서 (context-chain, ux-mode-transition)
├── docker-compose.yml   # 단일 서비스 원클릭
└── Dockerfile           # 멀티스테이지 (web 빌드 + api 빌드 → 런타임)
```

### 데이터 모델

`Project 1—N Document 1—N Section`. `Document`는 `parent_document_id`로 체인을 이룬다.
`InterviewSession`이 답변·진행률을 저장(자동 저장·재개). 부가: `api_keys`(암호화),
`document_versions`(스냅샷), `share_links`, `settings`. 스키마는 `db/schema.sql` 참조.

---

## 아키텍처 — AI 호출 추상 레이어

모든 AI 호출은 `api/src/providers/`의 추상 인터페이스(`AIProvider`)를 경유한다. **라우트/로직에서
제공자 API를 직접 호출하지 않는다.**

```
AIProvider (interface)
├── BYOKProvider (v1)          Anthropic / OpenAI / OpenRouter — 사용자 키
│   ├── AnthropicProvider
│   └── OpenAICompatProvider ── OpenAIProvider · OpenRouterProvider
├── StubProvider               오프라인 결정적 (AI_STUB=1, 테스트/데모)
└── ManagedProvider (v2)       관리형 티어 — 인터페이스만, 구현 미포함
```

`MANAGED_TIER=true`로 설정하면 `ManagedProvider`로 전환되는 구조를 유지한다(관리형 클라우드
티어 대비, 아래 수익 모델 참조). v1은 `ManagedProvider`를 구현하지 않는다.

---

## 수익 모델 (P-03) — 선택 **A: 관리형 클라우드 티어**

v1은 **BYOK + 셀프호스팅** 단일 경로다. 장기 방향은 **관리형 클라우드 티어(옵션 A)** 로,
BYOK·셀프호스팅은 그 상위(고급) 옵션으로 격상한다. v1 구현 범위에는 포함하지 않으나,
위 AI 추상 레이어가 `MANAGED_TIER` 분기를 수용하도록 설계되어 있어 티어 전환이 가능하다.

---

## 보안 — BYOK 키 저장

- 제공자 키는 **AES-256-GCM으로 암호화**되어 저장된다. **평문으로 DB에 저장하지 않는다.**
- 마스터 키는 `APP_ENCRYPTION_KEY`(32바이트 base64/hex)에서 오거나, 없으면 첫 부팅 시 생성해
  `data/master.key`(퍼미션 600)에 보관한다. **프로덕션에서는 `APP_ENCRYPTION_KEY`를 명시**해
  데이터 디렉터리를 지워도 키를 복구할 수 있게 하라.
- API는 키 메타데이터(마지막 4자리 등)만 반환하며 키 원문을 절대 노출하지 않는다.
- 공유 HTML은 서버에서 `<script>`/inline 핸들러를 제거해 렌더한다(최소 sanitization).

---

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DRAFTING_PORT` | `8477` | 호스트 노출 포트 (compose → 컨테이너 8080) |
| `PORT` | `8080` | api 리슨 포트 |
| `DATABASE_PATH` | `data/drafting.sqlite` | SQLite 파일 경로 |
| `APP_ENCRYPTION_KEY` | (없으면 자동 생성) | BYOK 암호화 마스터 키 (32바이트) |
| `MANAGED_TIER` | `false` | true 시 ManagedProvider(v2, 미구현)로 전환 |
| `AI_STUB` | (off) | `1` 시 오프라인 스텁 AI (키 불필요) |

AI 제공자 키는 **이 파일이 아니라** 앱 내 설정 위저드에서 입력한다(BYOK).

---

## MVP 범위 & 가정 (AI 가정 — 기획 단계 미확정 항목)

- **문서 범위**: MVP는 **PRD + 기능명세서**에 집중. IA·유저플로우 템플릿도 포함하나 v2에서 고도화.
- **AI 인터랙션**: 하이브리드(챗 인터뷰 초안 → 구조 편집기 정제).
- **기본 제공자**: OpenRouter, BYOK. Anthropic·OpenAI도 지원.
- **인증**: 로컬 단독 실행(무인증)이 기본. 팀 협업(멀티유저)은 v2.
- **Notion 내보내기 / PDF**: **v1 미포함**(위원회 결정으로 v2 이연).
- **템플릿**: 문서 체인(PRD→기능명세→IA→유저플로우) 인터뷰 템플릿은 독립형 JSON
  (`api/templates/`) — 커뮤니티가 파일로 확장 가능.

---

## 사양 커버리지 (개발지시서 대응)

| 영역 | 구현 |
|------|------|
| P-01 상태 일관성 | `docs/spec/context-chain.md` + 스테일 배지 + 명시 승인 refresh (자동 덮어쓰기 없음) |
| P-02 UX 모드 최소화 | `docs/spec/ux-mode-transition.md` + 단일 워크스페이스 화면(전용 뷰어 없음) |
| P-03 수익 모델 | 위 §수익 모델 (옵션 A) + `MANAGED_TIER` 분기 |
| SPEC-01/02/03 인터뷰 | 템플릿 4종·힌트/예시·자동저장/재개 |
| SPEC-04 컨텍스트 승계 | 상위 섹션 주입(`getParentContext`) |
| SPEC-06/07 스트리밍/재생성 | SSE 섹션 스트리밍 · 섹션 단위 재생성 |
| SPEC-08/09/10 편집기 | 분할 동기 스크롤 · 드래그 재정렬 · 2초 자동 저장 |
| SPEC-11/12 프로젝트/버전 | 프로젝트 그루핑 · 버전 스냅샷·복원 |
| SPEC-05 의존 시각화 | 프로젝트 문서 체인 그래프 |
| SPEC-13/14 내보내기 | MD 다운로드 · 만료형 HTML 공유 링크 |
| SPEC-18/19 다중 제공자/설정 | 3종 키 등록·테스트 · 유형별 모델·토큰 |
| SPEC-20/21/22 설치/온보딩/버전 | Docker 원클릭 · 건너뛰기 불가 위저드 · 버전 배너 |

**금지 사항 준수**: G-01(평문 키 저장 금지) · G-02(하위 자동 덮어쓰기 금지) · G-03/04(Notion·PDF
v1 제외) · G-05(3단계 별도 화면 금지) · G-06(템플릿 외부 파일) · G-07(AI 추상 레이어) · G-08(범위
확장 금지 — 성공 지표 확정 후 PRD 갱신).

---

## 라이선스

MIT.
