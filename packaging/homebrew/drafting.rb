# Homebrew Cask 템플릿 — Drafting.
# 배포: 오너가 자체 tap(예: hanmariyang/homebrew-tap)에 이 파일을 두거나 homebrew-cask 에 PR.
#   릴리스마다 version/ sha256 갱신 필요(자동화 후보: brew bump-cask-pr).
#   설치:  brew install --cask hanmariyang/tap/drafting
cask "drafting" do
  version "1.3.0"

  on_arm do
    sha256 :no_check # 오너: shasum -a 256 Drafting-#{version}-arm64.dmg 로 채우기
    url "https://github.com/hanmariyang/drafting/releases/download/v#{version}/Drafting-#{version}-arm64.dmg"
  end
  on_intel do
    sha256 :no_check
    url "https://github.com/hanmariyang/drafting/releases/download/v#{version}/Drafting-#{version}.dmg"
  end

  name "Drafting"
  desc "Self-hosted AI planning workspace (interview → PRD → spec → IA → design system → 시안)"
  homepage "https://github.com/hanmariyang/drafting"

  app "Drafting.app"

  zap trash: [
    "~/Library/Application Support/Drafting",
    "~/Library/Preferences/dev.drafting.app.plist",
  ]
end
