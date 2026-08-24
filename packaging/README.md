# 배포 패키징 (오너 액션)

릴리스 CI(`v*` 태그)가 3-OS 인스톨러(dmg/nsis/AppImage) + GHCR 이미지를 이미 만든다.
아래는 **패키지 매니저 등록**을 위한 스캐폴드 — 코드가 아니라 오너 계정/PR 이 필요해 자동화 밖이다.

## DMG 브랜딩
`desktop/package.json` 의 `build.dmg` 에 창 크기·아이콘 좌표를 넣어 인스톨러 창을 정돈했다(적용: 다음 릴리스).
브랜딩 배경(마스코트/워드마크)을 넣으려면 `build/dmg-bg.png`(+`@2x`) 추가 후 `build.dmg.background` 지정.
서명·공증과는 별개 레이어라 안전.

## Homebrew (macOS)
- 파일: `packaging/homebrew/drafting.rb`
- 오너: 자체 tap repo `hanmariyang/homebrew-tap` 생성 → 이 cask 커밋. 릴리스마다 `version`/`sha256` 갱신
  (`brew bump-cask-pr` 자동화 가능). 설치: `brew install --cask hanmariyang/tap/drafting`
- 또는 homebrew-cask 본진에 PR(요건: 안정 릴리스·서명).

## winget (Windows)
- 파일: `packaging/winget/Drafting.installer.yaml` (+ 오너가 version/defaultLocale 매니페스트 2종 추가)
- 오너: `microsoft/winget-pkgs` 에 PR. `winget-create`/`komac` 로 릴리스마다 URL·SHA256 자동 생성 권장.
  설치: `winget install hanmariyang.Drafting`

## 요약 (남은 오너 액션)
1. (선택) DMG 배경 이미지 추가 → `build.dmg.background`.
2. Homebrew tap repo 생성 + cask 등록(또는 cask PR).
3. winget-pkgs PR(매니페스트 3종).
