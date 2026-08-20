# 산출물 스위트 상세 설계 — v0.4~v0.6 (6종 완성)

> 정본 시안: `docs/spec/mockups/deliverables-space.html` (승인됨 — 화면·컴포넌트·색·카피를 이 시안대로 구현한다).
> 디자인 규칙: `design/SYSTEM.md` · 캐릭터: `design/CHARACTER.md`. 이 문서가 구현의 단일 기준이다.

## 0. 목표

Drafting 한 프로젝트에서 **산출물 6종**이 나온다:
1. PRD (기존 섹션 문서 — 유지)
2. 기능명세서 (신규: 항목 트리)
3. IA (신규: 화면 목록 + 사이트맵)
4. 유저 플로우 (신규: 스텝 구조 + 다이어그램)
5. 와이어프레임 (파생: IA·SPEC·FLOW 수락분에서 결정적 렌더 — 편집 없음)
6. 개발 지시서 (파생: 정합성 검사 통과 후 컴파일)

관통 원칙(불변): **AI 산출은 전부 제안, 수락한 항목만 문서**. 그린 = 제안 상태 전용. 신규 상태색 **앰버 = 검사 위반** 하나만 추가. 위반은 리포트가 아니라 **수정 제안으로 회귀**한다.

## 1. 데이터 모델 (`db/schema.sql` — additive, idempotent 유지)

```sql
-- 구조 문서(기능명세·IA·플로우)의 항목. 섹션(sections)과 공존한다.
CREATE TABLE IF NOT EXISTS plan_items (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES plan_items(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,          -- 'feature-group'|'feature'|'page'|'flow'|'step'
  ref_id       TEXT NOT NULL,          -- 'F-01'|'F-01-3'|'PG-01'|'FLOW-01'|'FLOW-01.2' (서버 채번)
  position     INTEGER NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',   -- 수용 기준 등 본문(줄바꿈 구분)
  meta         TEXT NOT NULL DEFAULT '{}', -- JSON: 아래 §1.1
  status       TEXT NOT NULL DEFAULT 'proposed',  -- proposed|accepted|rejected
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_items_document ON plan_items(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_parent   ON plan_items(parent_id);
```

### 1.1 meta JSON (kind 별)

- `feature`: `{ "priority": "P0"|"P1"|"P2", "links": { "reqs": ["REQ-01"], "pages": ["PG-02"], "flows": ["FLOW-01"] }, "source": "Q3"|"REQ-01"|"PRD §4" }`
- `page`: `{ "page_type": "LIST"|"DETAIL"|"FORM"|"DASH"|"SETTINGS"|"GENERIC", "links": { "features": ["F-01-1"] } }`
- `flow`: `{ "links": { "features": ["F-01"] } }`
- `step`: `{ "page": "PG-02"|null, "branch": null|{"label":"예","from_step":"FLOW-01.3"}, "note": "겹침 재판정" }`

### 1.2 채번 (서버 전담 — **LLM 은 ref_id 를 절대 생성하지 않는다**)

- feature-group `F-01`, `F-02` … / feature `F-01-1` … / page `PG-01` … / flow `FLOW-01` … / step `FLOW-01.1` …
- 규칙: 문서 내 kind 별 max+1. **삭제된 번호 재사용 금지.** 생성 프롬프트 응답에 id 류 필드가 있어도 무시한다.
- `REQ-nn` 은 테이블이 아니라 **PRD 의 수락 섹션에서 파생**: position 순으로 REQ-01, REQ-02 …. 유틸 `reqIdsForProject(projectId)` 로 단일화.

### 1.3 suggestions 확장 (additive)

- `target_item_id TEXT REFERENCES plan_items(id)` 컬럼 추가 (nullable — 기존 섹션 제안과 공존).
- `kind` 에 `'lint'` 추가. lint 제안의 `source` = 위반 코드(`W-ORPHAN-SPEC` 등).
- 항목 제안 수락 → item.status='accepted' (+ 제안이 담은 patch 적용). 거절 → item 'rejected' (lint 제안 거절 = 해당 위반 **waive**, §4.3).

## 2. AI 생성 (구조 문서 3종)

- 기존 `resolveProvider`/`streamChat` 경유(G-07). CLI·BYOK·스텁 공용.
- 프롬프트: 문서 타입별 **JSON 출력 계약** (템플릿 `api/templates/*.json` 에 `itemSchema` 추가). LLM 은 `{ groups:[{title, features:[{title, body, priority, source, links…}]}] }` 형태의 **내용만** 반환 — ref_id 없음.
- 파서는 관대하게: 코드펜스 제거, 첫 `{`~마지막 `}` 추출, 실패 시 1회 재시도 후 명시적 에러.
- SSE: `item` 이벤트 단위로 방출(파싱 완료분부터). CLI 폴백(전문 일괄)도 허용 — 최종 결과 동일하면 됨.
- 생성물은 전부 `status='proposed'` + 각 항목에 suggestion(근거 포함) 자동 생성 — 기존 문법 그대로.
- **스텁(AI_STUB=1)**: 결정적 items 픽스처 반환(테스트·데모용— 회의실 예약 예제와 유사한 3그룹/6페이지/3플로우 규모).

## 3. API

```
GET    /api/documents/:id/items                    트리(정렬된 평탄 리스트 + parent_id)
POST   /api/documents/:id/items                    수동 추가 {kind,title,body,meta,parentId}
PATCH  /api/items/:id                              {title,body,meta,position}
DELETE /api/items/:id
POST   /api/items/:id/accept | /reject
GET    /api/documents/:id/items/generate/stream    SSE 생성 (EventSource, 기존 draft/stream 패턴)
GET    /api/projects/:id/lint                      {violations:[{code,message,refs:[ref_id]}], waived:[…]}
POST   /api/projects/:id/lint/suggest              위반→lint suggestion 생성(중복 생성 금지 — 위반 코드+refs 로 dedupe)
GET    /api/projects/:id/wireframes                파생 데이터 §5
POST   /api/projects/:id/handoff                   게이트 검사 → 지시서 문서 생성(§6)
GET    /api/projects/:id/handoff/prompt-pack       text/markdown
GET    /api/projects/:id/hub                       6 산출물 집계 {perDoc:{accepted,proposed,total}, lint, derived}
```

## 4. 정합성 검사 (컴파일 — 결정적, AI 미사용)

### 4.1 룰 v1 (6종)

| 코드 | 검사 | 심각도 |
|---|---|---|
| `E-BROKEN-REF` | links 가 가리키는 ref(REQ/F/PG/FLOW)가 존재하지 않거나 rejected | E |
| `E-DUP-REF` | 같은 문서에 중복 ref_id (불변식 위반 감지) | E |
| `W-ORPHAN-SPEC` | accepted feature 의 reqs 링크 0 | W |
| `W-UNREACHED-PAGE` | accepted page 가 어느 accepted step 에도 참조되지 않음 | W |
| `W-EMPTY-PAGE` | accepted page 의 features 링크 0 | W |
| `W-NO-FLOW` | P0 accepted feature 가 어느 flow links 에도 없음 | W |

수락(accepted) 항목만 검사 대상. 순수 함수 `lintProject(items, reqIds)` 로 구현 — **전 룰 단위 테스트 필수**.

### 4.2 제안 회귀

`POST lint/suggest` 는 위반마다 lint suggestion 을 만든다(초안이 보이스, 위반 코드 표기, 선택지형 본문 — 시안 2 우측 카드). 수락 시 서버가 코드별 정해진 수선을 적용(예: W-ORPHAN-SPEC → 새 REQ 제안 or feature reject).

### 4.3 waive

lint suggestion 을 **거절 = 그 위반을 무시(waive)** 로 기록(`settings` 또는 suggestions status 로 판정). waive 된 위반은 게이트에서 제외하되 허브·지시서에 "무시 n건" 표기.

## 5. 파생 렌더 (AI·비용 0 — 편집 UI 없음)

### 5.1 와이어프레임 (시안 5)

- 입력: 수락 page + 연결 feature 제목 + 관련 step.
- `page_type` 템플릿 5종+GENERIC: LIST(검색 인풋+행 반복+행 버튼) · DETAIL(타이틀+슬롯/본문+주 CTA) · FORM(레이블 필드 2~4+제출) · DASH(스탯 카드 3+막대 차트) · SETTINGS(토글 행) · GENERIC(제목+본문 블록).
- **콘텐츠 시드**: 연결 feature 제목·body 에서 추출(행 텍스트·버튼 레이블·필드명). 결정적 — 같은 입력 = 같은 출력.
- **핫스팟**: flow step 이 "PG-A 다음 step 이 PG-B" 이면 PG-A 의 주 CTA 에 `→ PG-B` 배지 + 인터랙티브 모드에서 클릭 이동.
- 상태줄: 근거 F-/FLOW- 표기, lint 위반 페이지는 앰버 문구.
- 렌더는 웹 컴포넌트(React)로. PNG 내보내기는 v1 범위 외(버튼만 disabled 로 두지 말고 아예 생략 가능).

### 5.2 플로우 다이어그램 (시안 4)

- 레인 = flow. 노드 문법: 시작 캡슐(잉크) / 화면 사각(PG- 표기) / 판단 마름모(앰버, `branch` 있는 지점) / 완료 캡슐(그린).
- 분기 step 은 아래 서브트랙(elbow) 으로. 루프는 note 텍스트.
- 편집은 스텝 리스트 모드(트리 에디터), 다이어그램은 보기 정본. `mermaid` 텍스트 내보내기(flowchart LR) 버튼 1개.

## 6. 개발 지시서 (시안 6)

- 게이트: `lintProject` 의 E+W(waive 제외) 0건일 때만 생성 가능. 화면 상단에 룰별 체크리스트(통과/위반/waive).
- 생성: 결정적 골격(§1 개요·스코프 / §2 요구 / §3 기능 목록(근거·수용 기준 포함) / §4 화면·플로우 / §5 비범위) + AI 는 §1 요약문 1개만 생성(제안으로).
- 지시서는 `documents` 의 새 타입 `'handoff'` 문서(섹션 기반 — 기존 편집기 재사용, **역시 제안으로 들어와 수락 후 확정**).
- 출구: ① 프롬프트 팩(md — 에이전트 발주용: 지시서 전문 + "수락된 항목만 구현하라" 헤더) ② Markdown ③ 기존 공유 링크.
- 태그라인 변주: "수락하지 않은 항목은 지시서에 없습니다".

## 7. UI (시안 6프레임 재현)

- **nav 재편** (전 화면 공통): `산출물` 그룹(INT·PRD·SPEC·IA·FLOW) + `파생` 그룹(WF·DEV — 배지 dashed, WF="자동", DEV=잠김 시 "검사 n건") + 하단 `◧ 산출물 허브` 링크. 제안 수 그린 도트 유지.
- **허브** (시안 1): `/projects/:pid` (기존 ProjectView 대체). 6카드(항목 단위 바: 잉크=수락·그린=제안·회색=빈), WF 카드 미니 프리뷰, DEV 카드 잠김. 하단 게이트 스트립(초안이 fetch 미니 + 위반 요약 + "제안 n건 보기").
- **SPEC** (시안 2): 요약 칩 바 / 컬럼 헤더 / 그룹 행(연결 칩+하위 집계) / 행(들여쓰기·근거·우선순위) / **확장 카드**(제안·선택 행: 수용 기준, 연결 칩, 근거 인용, ✓×) / 위반 행 앰버 pill.
- **IA** (시안 3): 사이트맵 다이어그램(루트→버스→컬럼 체인, 제안=점선 그린 노드, 위반=앰버 노드) + 노드 선택 시 하단 상세(미니 프리뷰 썸네일 + 근거 기능 + 진입 플로우). 리스트 편집 모드 토글 제공.
- **FLOW** (시안 4) · **WF** (시안 5) · **DEV** (시안 6): §5·§6 대로.
- **토큰**: `tokens.css` 에 앰버 3종 추가(`--warn:#8A6A1F`, `--warn-bg:#FBF4E2`, `--warn-line:#EBDFBB`) — hex 하드코딩 금지 규칙 그대로, `design/SYSTEM.md` §1 표에도 추가.
- **초안이**: 운용 3원칙 유지. 등장 위치 추가분 = lint 제안 카드·허브 게이트 스트립(fetch, 정지) 뿐.

## 8. 테스트 (기존 31개 유지 + 신규)

- 채번 유틸(재사용 금지·kind 별), lint 6룰 전수(픽스처), JSON 파서 관대성(코드펜스·후행 텍스트), handoff 게이트(위반 시 409·waive 반영), 스텁 AI 로 items 생성 e2e, 핫스팟 매핑(flow→wireframe), hub 집계.

## 9. 금지 (기존 G 규칙에 추가)

1. LLM 의 ref_id/채번 생성 금지 — 서버 전담.
2. 파생물(WF·다이어그램) 편집 UI 금지 — 편집은 원본(IA·FLOW)에서.
3. 상위 자동 덮어쓰기 금지(기존 G-02) — 구조 문서에도 동일(stale → 재제안).
4. 그린·앰버 외 상태색 신설 금지. hex 하드코딩 금지(전부 var).
5. PRD 등 기존 섹션 문서 경로·기존 API 파괴 금지 (additive).
6. 헤드리스 구현 제약: **git commit·npm install 등 Bash 실행 금지** — 파일 편집만. 의존성 추가 금지(현 스택으로 구현 가능).

## 10. 수용 기준 (시안 프레임 대응)

- [ ] 허브: 6카드+게이트, 나브 재편이 전 화면에 적용
- [ ] SPEC: 트리+확장 카드+행 수락, 요약 칩, 앰버 위반 행
- [ ] IA: 사이트맵(제안 점선·위반 앰버)+선택 상세, 리스트 편집 모드
- [ ] FLOW: 스텝 편집 + 레인 다이어그램(분기·판단·완료), mermaid 내보내기
- [ ] WF: 타입 템플릿 렌더+콘텐츠 시드+핫스팟+인터랙티브 이동
- [ ] DEV: 게이트 체크리스트, 지시서 생성(제안), 프롬프트 팩/MD/공유
- [ ] lint 6룰 + 제안 회귀 + waive
- [ ] AI_STUB=1 로 전 플로우 재현 가능(키·CLI 없이)
- [ ] `npm test` 전부 통과(신규 포함), `tsc --noEmit` 0 에러
