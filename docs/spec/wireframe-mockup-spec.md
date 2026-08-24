# 와이어프레임 → 시안 고도화 설계 (A·B·C)

> 문제: 현재 와이어프레임은 의도적으로 "저해상도·결정적·AI 0" 구조 프리뷰(page_type 5종 고정 템플릿)라
> "designed 시안" 느낌이 없다. 완료 후 시안을 보고 구현 여부를 정하려는 흐름에 부족.
> 해결: **프로젝트 StyleGuide(테마) 하나**로 세 레이어를 묶는다.

## 통합 아키텍처 — StyleGuide 가 중심

```
StyleGuide(테마) ──┬─▶ (C) 사용자 스타일 입력: 프리셋 선택 + 액센트/밀도/폰트 커스텀
                   ├─▶ (B) 결정적 와이어프레임을 그 테마로 렌더 (AI 0, 무료·즉시)
                   └─▶ (A) AI 가 같은 테마로 실제 HTML 시안 생성 (옵트인·제안 문법)
```

한 벌의 테마가 무료 와이어프레임과 AI 시안을 **한 디자인 언어로 일관**시키는 것이 핵심.

## C. StyleGuide (스타일 입력)

- 저장: 프로젝트별 `setSetting('style_guide:<pid>', guide)` (스키마 변경 없음).
- 토큰: `preset, accent, bg, surface, ink, sub, line, radius, density(compact|cozy|spacious), font(sans|serif|rounded|mono), mode(light|dark)`.
- 프리셋(뚜렷이 구분): `clean`(SaaS 인디고)·`warm`(에디토리얼 세리프)·`mono`(유틸리티)·`vivid`(플레이풀 라운드)·`dark`(다크 SaaS).
- API: `GET/PUT /api/projects/:id/style-guide`.
- UI: 와이어프레임 상단 테마 바(프리셋 칩 + 액센트 색 + 밀도 토글). 변경 즉시 전체 재렌더.

## B. 결정적 와이어프레임 테마화 (고해상도·무료)

- 렌더러(`WfProto`)가 StyleGuide 토큰을 CSS 변수(`--wf-*`)로 받아 표면·액센트·라운드·폰트·간격 적용.
- 템플릿 5종을 "골격"에서 "테마 입힌 컴포넌트"로: 액센트 버튼, 표면 카드+그림자, DASH 액센트 차트,
  LIST 아바타·상태 배지, FORM 라벨/인풋 스타일 등. 여전히 결정적(AI 0)이라 즉시·무료.
- 제품별 미감은 여기까지가 한계(범용) — "바로 이 제품 시안"은 A 가 담당.

## A. AI 시안 (옵트인·제안 문법)

- 저장: 신규 `mockups` 테이블 `(id, project_id, page_ref UNIQUE, html, status, style_key, created_at)`. 지연 로드.
- 생성: `POST /api/items/:id/mockup` — 페이지(item) 1개에 대해 provider(resolveProvider) 로
  **자기완결 HTML 화면** 생성. 입력 = 페이지 제목·타입 + 연결 기능 콘텐츠 + **StyleGuide 토큰**(일관성).
  `AI_STUB` 이면 테마 반영 결정적 HTML(테스트·오프라인).
- 제안 문법: 생성물 status=`proposed` → `POST .../mockup/accept`(=accepted) / `reject`(삭제) / 재생성.
- 렌더: 샌드박스 iframe(`srcdoc`, `sandbox` 제한)에 표시. 와이어프레임 ↔ 시안 뷰 토글.
- 트레이드오프: 결정적·무료였던 기능에 AI 비용·비결정성 유입 → **기본=무료 와이어프레임, 시안=명시 옵트인**.

## D. (추후) 외부 확장 — 다운스트림 위임

구조/시안 스펙을 프롬프트·스펙으로 내보내 v0·피그마·코딩 에이전트가 시안/코드를 생성.
Drafting 은 기획·구조의 SSOT 로 남고, 고급 시안·실제 코드는 외부 도구로. **외부 확장 기능으로 추후 검토**(백로그).

## 구현 순서

1. StyleGuide 백엔드(lib+routes) → 프론트 테마 바 + B 테마 렌더 (무료 경로 완성).
2. mockups 테이블·repo·routes + stub HTML → 프론트 시안 뷰(iframe)·제안 문법 (A).
3. 실 LLM 시안 생성 실측 + 문서/체인지로그.
