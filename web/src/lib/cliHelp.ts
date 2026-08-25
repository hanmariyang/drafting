/** CLI(구독) 실패 원문 → 원인 + 조치. 빨간 원문 대신 "왜 안 되고 무엇을 하라"를 준다. */
export function cliHelp(detail: string): { cause: string; action: string } {
  const d = (detail || '').toLowerCase();
  if (/찾지 못|not found|미감지|no such|실행 실패|enoent/.test(d))
    return {
      cause: 'claude CLI 를 못 찾았습니다',
      action: 'claude 를 설치·로그인하거나, 설정에서 claude 전체 경로를 지정하세요. 안 되면 API 키(BYOK)로 전환하는 게 빠릅니다.',
    };
  if (/oauth|session expired|not logged|log ?in|authenticat|credential|invalid api key|unauthorized/.test(d))
    return {
      cause: '로그인 세션을 읽지 못했습니다 (만료 또는 앱이 키체인 접근 불가)',
      action: '터미널에서 claude 로그인 상태를 확인하세요. 앱을 파일 복사로 설치했다면 정식(공증) 인스톨러로 재설치가 확실합니다. 급하면 API 키(BYOK)로 전환.',
    };
  if (/disabled|subscription access|organization|blocked|api key instead|403|401/.test(d))
    return {
      cause: '조직이 Claude Code 구독 접근을 막았을 수 있습니다',
      action: 'API 키(BYOK)로 전환해 Anthropic/OpenRouter 키를 등록하세요.',
    };
  if (/시간 초과|timeout|timed out/.test(d))
    return { cause: '응답이 지연됐습니다', action: '네트워크·로그인 상태를 확인하고 다시 시도하세요.' };
  return { cause: '구독 엔진을 쓸 수 없습니다', action: 'API 키(BYOK)로 전환하거나 claude 설치·로그인 상태를 확인하세요.' };
}
