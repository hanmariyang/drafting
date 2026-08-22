/**
 * provider(직접·게이트웨이) 에러를 사용자 언어 + 해결 힌트로 표준화한다.
 * 원문은 detail 로 보존한다. UI 배너·카드가 그대로 읽어 도움말을 준다.
 */
export function humanizeProviderError(status: number, rawBody: string): string {
  const body = (rawBody || '').slice(0, 400);
  const lc = body.toLowerCase();

  // 모델 접근 권한 없음 (게이트웨이 모델 그룹 제한 등) — 401 로도 오므로 auth 분기보다 먼저.
  if (/not allowed to access model|model.*not found|does not exist|no endpoints found/i.test(lc)) {
    return (
      '이 키로 접근할 수 없는 모델입니다. 설정의 모델 칸을 게이트웨이가 제공하는 모델로 바꾸세요' +
      '(드롭다운). · ' + body
    );
  }
  // 인증 헤더 없음 / 잘못된 키 — base URL 이 표준 provider 를 가리키는데 게이트웨이 키를 넣은 전형
  if (status === 401 || /missing authentication|unauthorized|invalid api key|no auth/i.test(lc)) {
    return (
      '인증 실패(401). 키가 이 엔드포인트와 맞는지 확인하세요. ' +
      '게이트웨이(LiteLLM 등)를 쓴다면 설정의 "OpenAI 호환 게이트웨이" base URL 을 넣고, ' +
      '키는 그 게이트웨이 키여야 합니다. · ' + body
    );
  }
  // 모델별 게이트(예: 18+ 확인)
  if (status === 403 || /age.?confirm|attestation|requires you to complete|forbidden/i.test(lc)) {
    return (
      '이 모델은 계정에서 추가 확인(예: 연령 확인)이 필요하거나 접근이 막혀 있습니다. ' +
      '다른 모델을 쓰거나 provider 설정에서 확인을 마치세요. · ' + body
    );
  }
  if (status === 429 || /rate limit|too many requests|quota/i.test(lc)) {
    return '요청이 많거나 한도를 초과했습니다(429). 잠시 후 다시 시도하세요. · ' + body;
  }
  if (status >= 500) {
    return `provider 서버 오류(${status}). 잠시 후 다시 시도하세요. · ` + body;
  }
  return `${status}: ${body}`;
}
