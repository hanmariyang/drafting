/**
 * OpenAI 호환 게이트웨이(LiteLLM·Azure·사내 프록시) 자동 감지 유틸.
 *  - 사용자가 `/v1` 을 붙였는지 몰라도 되게 경로를 자동 탐지한다.
 *  - 게이트웨이의 `/models` 를 조회해 실제 사용 가능한 모델 목록을 돌려준다(드롭다운·테스트용).
 * 특정 회사에 종속되지 않는다 — 넣은 base URL 의 게이트웨이를 그대로 조회한다.
 */

export interface GatewayProbe {
  /** chat/completions 를 붙일 정규화된 base (예: `.../v1`). */
  chatBase: string;
  /** 게이트웨이가 노출하는 모델 id 목록. */
  models: string[];
}

/** rawBase 에서 `/models` 가 응답하는 경로를 찾아 chatBase 와 모델 목록을 반환. 실패 시 null. */
export async function probeGateway(
  rawBase: string,
  key: string,
  headers: Record<string, string> = {},
): Promise<GatewayProbe | null> {
  const b = rawBase.trim().replace(/\/+$/, '');
  if (!b) return null;
  // (models 조회 URL, 그때의 chat base) 후보 — 이미 /v1 이면 그대로, 아니면 /v1 우선 후 루트.
  const candidates: [string, string][] = b.endsWith('/v1')
    ? [[`${b}/models`, b]]
    : [
        [`${b}/v1/models`, `${b}/v1`],
        [`${b}/models`, b],
      ];
  for (const [url, chatBase] of candidates) {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${key}`, ...headers },
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { data?: Array<{ id?: unknown }> };
      const models = Array.isArray(j?.data)
        ? j.data.map((m) => m?.id).filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [];
      return { chatBase, models };
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

/** OpenRouter 공개 모델 목록 — 표준 OpenRouter(BYOK) 사용 시 드롭다운 채우기용.
 *  listing 은 인증 불필요(키 있으면 계정 반영). 실패 시 빈 배열. */
export async function fetchOpenRouterModels(key?: string): Promise<string[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return Array.isArray(j?.data)
      ? j.data.map((m) => m?.id).filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
  } catch {
    return [];
  }
}
