# 디자인 시스템 인터뷰 설계

> 시안의 최종 목적은 "컴포넌트 그리기"가 아니라 **그 제품의 디자인 시스템을 설계하기**다.
> 지금 StyleGuide(프리셋)를 **인터뷰로 설계하는 디자인 시스템**으로 승격한다.
> 결정(2026-08): **신규 `design-system` 문서 타입** + **P1 먼저 구현**.

## 개념

- 프리셋을 "고르는" 게 아니라 인터뷰로 **설계**하고 AI가 제안(제안→수락)한다.
- 산출물 = **DesignSystem**(StyleGuide 확장) + **스타일 타일 프리뷰**.
- 이게 와이어프레임(B)·AI 시안(A)을 한 디자인 언어로 구동한다. 프리셋은 인터뷰의 빠른 시드로 유지.

## 왜 신규 문서 타입인가

인터뷰 기계장치는 문서 기반(`InterviewSession.document_id`)이라, `design-system` 문서를 만들면
**인터뷰·세션·자동저장·제안 문법·버전을 그대로 재사용**한다. 다만 산출물이 산문이 아니라 구조화 토큰이라,
IA/구조 문서처럼 "구조 생성" 경로(프로세문 대신 DesignSystem 객체)를 쓴다.

## 체인 위치

`PRD → 기능명세 → IA → 유저플로우 → **디자인 시스템** → 와이어프레임/시안`
(브랜드 맥락은 주로 PRD에서 상속. 시각 산출 직전에 둔다.)

## 인터뷰 질문 세트 (`api/templates/design-system.json`, 7문)

우리 `design/SYSTEM.md` 해부(색 역할·타이포·간격·형태·컴포넌트·톤) 기반.

1. **personality** — 제품이 주는 느낌을 형용사 3개로 (예: 신뢰·차분·전문 / 활기·친근·경쾌)
2. **reference** — 비슷한 느낌의 제품/브랜드 + 왜 (Linear·Toss·당근…)
3. **context** — 주 사용 환경(모바일/데스크톱, 밝은/어두운) → light/dark·밀도
4. **color** — 브랜드/강조색 유무(없으면 성격에서 도출) + 피해야 할 색
5. **typography** — 서체 성격(모던 산세/클래식 세리프/친근 라운드/기능 모노) + 정보 밀도
6. **components** — 각진 vs 둥근, 그림자/보더 취향, 버튼·카드 느낌
7. **accessibility** — 고대비·색맹 대응·특정 규정 등 제약

## 산출물 — DesignSystem (StyleGuide 확장)

```
{ preset?, mode(light|dark),
  color: { bg, surface, ink, sub, line, accent, accentWeak, ok, warn, danger },
  type:  { displayFace, bodyFace, monoFace, scale, weight },
  space: { unit, density(compact|cozy|spacious) },
  shape: { radius, border, shadow(none|soft|strong) },
  tone:  [키워드…],
  rationale: "답변 → 토큰 선택 근거" }
```

- 기존 StyleGuide(`accent/bg/surface/ink/sub/line/radius/density/font/mode`)의 **상위집합** — 하위호환.
- 수락 시 프로젝트 StyleGuide 로 반영(기존 B/A 파이프라인이 그대로 소비).

## 미리보기 — 스타일 타일

색 **역할** 스와치 + 타입 스펙(H1/본문/캡션) + 컴포넌트 샘플(버튼 primary/secondary·카드·인풋·칩·상태).
자기완결 HTML(시안 A 의 mockup 파이프라인 재사용) 또는 결정적 렌더. 제안→수락 문법.

## 단계

- **P1 (선택됨)**: `design-system` 문서 타입 + 인터뷰 템플릿(7문) + 구조 생성(→DesignSystem, 제안→수락)
  + 스타일 타일 프리뷰 + 와이어프레임/시안이 소비(프리셋 피커를 "이 디자인 시스템 사용"으로). 프리셋=시드 유지.
- **P2**: AI 가 2~3개 시스템 **방향안**을 제시해 고르기(디자인 탐색 · judge/panel).

## 구현 착수점 (탐색 결과)

- 타입: `api/src/lib/types.ts:1` DocumentType 에 `design-system` 추가.
- DOC_TYPES: `api/src/routes/interview.ts:137`, `documents.ts:8`.
- 체인: `api/src/routes/deliverables.ts` CHAIN + 라벨.
- 템플릿: `api/templates/design-system.json`(질문·섹션·draftGuidance).
- 생성: 산문 draft 대신 구조 생성(items-gen 계보) → DesignSystem. StyleGuide 반영은 기존 `style-guide.ts`.
- 프리뷰: `mockup-gen.ts` 의 HTML 파이프라인 재사용(스타일 타일 프롬프트).
