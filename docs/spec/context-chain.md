# P-01 — 상태 일관성 설계 (Context Chain)

> 상위 섹션을 재생성하면 하위 문서가 구버전 컨텍스트를 붙들고 있는 결함을 막는다.
> **핵심 원칙: 사용자 확인 없이 하위 문서를 자동으로 덮어쓰지 않는다 (G-02).**

## 1. 문서 체인 모델

문서는 유형에 따라 사슬을 이룬다:

```
PRD ──▶ 기능명세서 ──▶ IA ──▶ 유저플로우
 (parent)   (child)      ...
```

- 각 `Document` 는 `parent_document_id` 로 상위 문서를 가리킨다.
- 하위 문서의 인터뷰·초안 생성 시, 상위 문서의 **확정된 섹션 본문**이 컨텍스트로 주입된다(SPEC-04).
- 주입 시점의 상위 문서 버전 번호를 하위 문서의 `context_source_version` 에 기록한다.

## 2. 스테일(stale) 감지

상위 문서에 "구조적 변경"이 발생하면 하위 문서의 인계 컨텍스트가 낡는다.

**구조적 변경 = 스테일 트리거 이벤트:**

| 이벤트 | 스테일 처리 |
|--------|------------|
| 상위 섹션 본문 수정 후 저장(SPEC-10) | 하위 전부 `context_stale=1` |
| 상위 섹션 재생성(SPEC-07) | 하위 전부 `context_stale=1` |
| 상위 섹션 추가/삭제/재정렬(SPEC-09) | 하위 전부 `context_stale=1` |
| 상위 문서 버전 복원(SPEC-12) | 하위 전부 `context_stale=1` |

스테일 판정 로직(서버 권위):

```
onParentDocumentChanged(parentId, newVersion):
    for child in documentsWhere(parent_document_id == parentId):
        if child.context_source_version != newVersion:
            child.context_stale = 1
            child.context_pending_version = newVersion   # 승계 대기 버전
```

`context_stale=1` 인 하위 문서는 편집기에서 **"컨텍스트 갱신 필요" 배지**를 표시한다(Phase 2 수용 기준).

## 3. 명시 승인 흐름 (자동 덮어쓰기 금지)

```
┌─────────────────────────────────────────────────────────────────┐
│ 상위 문서(PRD) 섹션 저장/재생성                                     │
│        │                                                          │
│        ▼                                                          │
│ 상위 버전++ (document_versions 에 'save' 스냅샷)                    │
│        │                                                          │
│        ▼                                                          │
│ 하위 문서(기능명세) context_stale = 1                              │  ← 자동은 여기까지만
│        │                                                          │
│        ▼                                                          │
│ [편집기] 하위 문서에 "컨텍스트 갱신 필요" 배지 노출                  │
│        │                                                          │
│        │   사용자가 배지 클릭                                      │
│        ▼                                                          │
│ 갱신 다이얼로그:                                                   │
│   ┌───────────────────────────────────────────┐                 │
│   │ 상위 문서가 변경되었습니다.                  │                 │
│   │ 무엇을 하시겠습니까?                        │                 │
│   │  (A) 컨텍스트만 갱신  — 하위 본문 유지        │  ← 기본값       │
│   │  (B) 컨텍스트 갱신 + 영향 섹션 재생성 제안    │  ← 섹션별 선택   │
│   │  (C) 나중에 (배지 유지)                      │                 │
│   └───────────────────────────────────────────┘                 │
│        │                                                          │
│   ┌────┴──────────────┬──────────────────┐                       │
│   ▼(A)                 ▼(B)               ▼(C)                    │
│ 인계 컨텍스트만 최신화   재생성은 섹션 단위    아무 것도 안 함        │
│ 하위 본문 불변          사용자가 개별 승인     배지 유지             │
│ context_stale=0        후에만 교체(SPEC-07)                        │
│ context_source_version 재생성 승인 시에도                          │
│  = 상위 최신 버전        타 섹션 불변                               │
└─────────────────────────────────────────────────────────────────┘
```

- **(A) 컨텍스트만 갱신**: `context_source_version` 을 상위 최신 버전으로 올리고 `context_stale=0`. 하위 문서 섹션 본문은 **한 글자도 바뀌지 않는다.** 이후 새 섹션 생성/재생성 시 최신 상위 컨텍스트 사용.
- **(B) 재생성 제안**: (A) + 각 하위 섹션 옆에 "재생성" 버튼 강조. 재생성은 **섹션 단위로 사용자가 개별 승인**해야 실행되며, 실행 시 해당 섹션만 교체(SPEC-07), 타 섹션 불변.
- **(C) 나중에**: 상태 변화 없음. 배지 유지.

어떤 경우에도 시스템이 사용자 확인 없이 하위 문서 본문을 자동으로 덮어쓰지 않는다.

## 4. 버전 히스토리 승계 이벤트 기록 (SPEC-12 연동)

`document_versions.event_type` 은 세 종류:

| event_type | 발생 시점 | snapshot 내용 |
|------------|----------|--------------|
| `save` | 자동/수동 저장 | 저장 시점 섹션 전체 |
| `context_inherit` | 위 흐름 (A) 또는 (B) 실행 | 갱신 후 섹션 전체 + `meta.inherited_from = {parent_document_id, parent_version}` |
| `restore` | 이전 버전 복원 | 복원된 섹션 전체 + `meta.restored_from_version` |

- 승계가 일어나면 하위 문서에 `context_inherit` 버전이 남으므로, "언제 어느 상위 버전을 인계받았는지" 감사 가능.
- 승계 이벤트도 하위의 하위(손자 문서)에 대해 다시 §2 스테일 로직을 촉발한다(연쇄).

## 5. API 표면

```
GET  /api/documents/:id                 → { ..., context_stale, context_source_version, context_pending_version }
POST /api/documents/:id/context/refresh → body { mode: 'context-only' }  # 흐름 (A)
                                          → context_stale=0, context_inherit 버전 생성
GET  /api/documents/:id/context/parent  → 승계 대상 상위 컨텍스트 프리뷰(diff 표시용)
```

재생성(B)은 기존 `POST /api/sections/:id/regenerate`(SPEC-07) 를 섹션 단위로 재사용한다 — 별도 자동 경로 없음.

## 6. 불변식 (테스트로 강제)

1. 상위 저장 → 모든 직계 하위 `context_stale=1` 이 된다.
2. `context/refresh(mode=context-only)` 후 하위 섹션 본문 해시가 변하지 않는다. (본문 불변 보장)
3. `context/refresh` 는 `context_inherit` 버전을 정확히 1개 추가한다.
4. 자동 경로(저장/재생성/복원) 중 어디에서도 하위 섹션 본문 UPDATE 가 발생하지 않는다.
