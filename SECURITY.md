# 보안 정책 (Security)

## 취약점 신고

보안 취약점을 발견하면 **공개 이슈로 올리지 말고**, 저장소의 GitHub Security Advisories
(Security → Report a vulnerability) 로 비공개 신고해 주세요. 확인 후 수정·공개 일정을 협의합니다.

## 배포 모델과 보안 경계

Drafting 은 **셀프호스트 단일 사용자** 도구입니다. 다음을 전제로 설계됐습니다.

- **API 자체 인증 없음** — 서버에 접근할 수 있는 사람 = 신뢰된 사용자로 간주합니다.
  따라서 **서버를 신뢰할 수 없는 네트워크에 그대로 노출하지 마세요.** 공개 노출이 필요하면
  앞단에 리버스 프록시 + 인증(예: 사내 SSO, basic auth, Cloudflare Access)을 두세요.
- **CORS 는 기본 same-origin 만 허용**합니다(교차 오리진 차단). 이는 사용자가 방문한 악성
  웹페이지가 로컬 API(`/api/backup` 등)를 호출해 데이터를 읽거나 삭제하는 것을 막습니다.
  다른 오리진에서 프론트를 서빙하는 리버스 프록시 구성만 `DRAFTING_ALLOW_ORIGINS`
  (쉼표 구분) 로 허용 오리진을 명시하세요.
- **BYOK 키는 AES-256-GCM 으로 암호화** 저장됩니다(`APP_ENCRYPTION_KEY`). 평문 저장 안 함.
- **백업/복원**(`/api/backup`, `/api/restore`)은 워크스페이스 전체를 다룹니다. 위 same-origin
  정책과 신뢰 네트워크 전제 하에서만 안전합니다.

## 지원 버전

최신 릴리스(main)만 보안 수정을 받습니다. 최신 버전 사용을 권장합니다.
