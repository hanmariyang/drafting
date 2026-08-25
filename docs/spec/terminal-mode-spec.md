# 터미널 모드 (`drafting serve`) + env-var BYOK

> 통찰(의뢰자): 구독·BYOK 문제를 한 번에 푸는 요소 = **Drafting 서버를 터미널에서 실행.**
> 서버가 "터미널 프로세스" 컨텍스트로 돌면 GUI 앱의 제약이 사라진다.

## 왜 둘 다 풀리나

두 문제의 뿌리는 **GUI 앱 프로세스의 환경**:
- **구독(CLI) 실패** — Drafting.app(GUI)이 백그라운드로 spawn 한 claude 는 macOS 키체인 접근을 못 받는다.
  터미널 claude 는 되는데(그 컨텍스트라). → 터미널에서 서버를 띄우면 spawn 된 claude 도 **터미널 컨텍스트**(키체인·PATH·env) 상속 → 됨.
- **BYOK 마찰** — 마법사·암호화 DB·모델 드롭다운. → 터미널이면 **env-var 로 키 주입**(dev 도구처럼).

## 구성

- **CLI**: `bin/drafting.mjs` — `drafting serve [--port] [--no-open]`. 데몬 기동 + 브라우저 오픈.
  `APP_ENCRYPTION_KEY` 자동 생성·보관(`~/.drafting/.enckey`, 사용자 관리 불필요). 데이터 `~/.drafting/drafting.sqlite`.
- **env-var BYOK**: `getDecryptedKey`/`getKeyMeta`/`listKeyMeta` 가 DB 없으면 env 폴백 —
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`(+`OPENAI_BASE_URL`) / `OPENROUTER_API_KEY` / `LITELLM_API_KEY`.
  env 키도 `keysConfigured` 에 잡혀 aiMode·온보딩이 인식.
- 배포: `package.json` `bin` + `files` → 향후 `npx drafting` / `npm i -g` (owner: npm publish).

## 실측 (이 저장소, 2026-08-25)

- 터미널 `drafting serve` → **구독(CLI)** 시안 생성 성공(21KB, claude 호출).
- `OPENAI_API_KEY`+`OPENAI_BASE_URL`(게이트웨이) → **env BYOK** 시안 생성 성공(7KB, deepseek-v4-flash). 마법사/DB 없음.

## 캐비엇

- **네이티브(node) 경로여야** 구독 이점 성립 — 도커는 컨테이너 격리라 호스트 claude 에 못 닿음.
- 대상 = 터미널 쓰는 개발자(= Drafting 타깃과 정합). 데스크톱 앱은 비개발자용으로 병존.
- 이 저장소 머신엔 GUI claude 도 되므로 "GUI 실패를 고친다"는 각 사용자 환경에서 최종 확인 권장 —
  다만 터미널 경로가 두 엔진 모두 동작함은 실측됨(원리상 그 GUI 키체인 실패를 우회).
