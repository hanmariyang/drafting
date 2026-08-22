# 기여 가이드 (Contributing)

Drafting 에 기여해 주셔서 감사합니다. 이 문서는 개발·PR 흐름을 요약합니다.

## 개발 환경

```bash
npm install
npm run dev          # api :8080 + web :5173 (vite 가 /api, /s 프록시)
npm test             # api node:test — 계약 강제형
npm run build        # web + api 빌드
```

Node ≥ 22 필요(내장 `node:sqlite`, `--experimental-strip-types` 사용).

## 브랜치 · PR

- `main` 에 직접 푸시하지 말고 브랜치에서 작업 후 PR 을 엽니다.
- PR 을 열면 `ci` 워크플로가 `npm test` + `npm run build` 를 자동 실행합니다. **초록이어야 머지**합니다.
- 커밋 메시지는 한 줄 요약 + 필요 시 본문. 한국어/영어 모두 환영.

## 설계 원칙 (지켜주세요)

- **문법 우선**: AI 출력은 항상 `proposed`. 수락해야만 문서가 됩니다. 내보내기·공유는 수락분만.
- **자식 문서 자동 덮어쓰기 금지**: 상위 변경은 stale 표시 + 재제안만.
- **BYOK 키 평문 저장 금지**: AES-256-GCM(`APP_ENCRYPTION_KEY`). 이를 강제하는 테스트를 유지하세요.
- **디자인 토큰만**: `web/src/styles/tokens.css`(=`design/SYSTEM.md`). 컴포넌트 CSS 에 hex 하드코딩 금지. 제안 그린은 상태색 전용(장식 금지), 좌측 액센트 바·이모지 아이콘 금지.
- **시크릿·사용자 경로를 레포에 넣지 않기**: 설정은 env 전용(`.env.example`).

## 모든 AI 호출은 provider 게이트를 통과

`api/src/providers/`(`resolveProvider` 단일 게이트)로만. `AI_STUB=1` 로 오프라인 결정적 테스트.

## 테스트

기능·엔드포인트를 추가하면 `api/test/` 에 계약 테스트를 함께 추가하세요. 스텁 provider 로 네트워크 없이 전 흐름을 검증할 수 있습니다.

## 보안 이슈

보안 취약점은 공개 이슈로 올리지 말고 [SECURITY.md](SECURITY.md) 절차를 따라주세요.
