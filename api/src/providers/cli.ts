/**
 * CLI(데몬) 프로바이더 — 사용자의 로컬 에이전트 CLI(Claude Code)를 스폰해
 * 구독 인증으로 생성한다. API 키가 필요 없다 (coxpit-oss providers.ts 계보).
 *
 * 격리 원칙 (2026-08-20 실측): CLI 는 cwd 의 CLAUDE.md·메모리·스킬을 주입하므로
 *   - 빈 전용 cwd (dataDir/agent)
 *   - --setting-sources "" (사용자/프로젝트 설정 차단)
 *   - --system-prompt 교체 (+ 동적 섹션 제외)
 * 없이는 워크스페이스 맥락이 문서에 새어 들어간다.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../lib/config.ts';
import type { AIProvider, StreamParams, TestResult } from './types.ts';

const BIN_CANDIDATES = [
  process.env.DRAFTING_AGENT_BIN ?? '',
  'claude',
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(os.homedir(), '.claude', 'local', 'claude'),
].filter(Boolean);

let cachedBin: string | null | undefined;

/** GUI 앱은 셸 PATH 를 물려받지 못한다 — 알려진 경로를 직접 탐색한다. */
export function resolveCliBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  for (const cand of BIN_CANDIDATES) {
    if (cand.includes(path.sep)) {
      if (fs.existsSync(cand)) return (cachedBin = cand);
    } else {
      const r = spawnSync('which', [cand], { encoding: 'utf8' });
      const found = r.status === 0 ? r.stdout.trim() : '';
      if (found) return (cachedBin = found);
    }
  }
  return (cachedBin = null);
}

export function cliAvailable(): boolean {
  return resolveCliBin() !== null;
}

/** 세션 캐시 무효화 (설정에서 경로를 바꾼 직후 등) */
export function resetCliBinCache(): void {
  cachedBin = undefined;
}

/** API 모델 id → CLI 별칭. CLI 는 풀 id 도 받지만 별칭이 구독 기본값과 정합. */
function cliModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  return model || 'sonnet';
}

interface CliEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: { type?: string; text?: string }[] };
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

/** stream-json 한 줄 → 텍스트 델타 (없으면 null). 테스트에서 직접 검증한다. */
export function deltaFromLine(line: string): string | null {
  let ev: CliEvent;
  try {
    ev = JSON.parse(line) as CliEvent;
  } catch {
    return null;
  }
  if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') {
    return ev.event.delta.text ?? null;
  }
  return null;
}

/** 최종 assistant 텍스트 (partial 미지원 CLI 폴백용). */
export function textFromAssistantLine(line: string): string | null {
  let ev: CliEvent;
  try {
    ev = JSON.parse(line) as CliEvent;
  } catch {
    return null;
  }
  if (ev.type !== 'assistant') return null;
  const parts = (ev.message?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '');
  return parts.length ? parts.join('') : null;
}

export function errorFromResultLine(line: string): string | null {
  let ev: CliEvent;
  try {
    ev = JSON.parse(line) as CliEvent;
  } catch {
    return null;
  }
  if (ev.type === 'result' && ev.is_error) return ev.result || 'agent CLI returned an error';
  return null;
}

/**
 * 구독 차단(조직이 Claude Code 구독 접근을 끈 경우)·미로그인 등 인증 계열 에러에
 * 앱 안에서의 해결 경로를 덧붙인다. 원문은 보존한다.
 */
export function actionableCliError(msg: string): string {
  if (/disabled Claude subscription|API key instead|log ?in|authenticat|OAuth|credential/i.test(msg)) {
    return (
      `${msg} — 설정(⌘,)에서 엔진을 API 키(BYOK) 모드로 전환해 Anthropic/OpenRouter 키를 등록하거나, ` +
      `이 머신의 claude CLI 를 구독이 허용된 계정으로 다시 로그인(claude /login)하세요.`
    );
  }
  return msg;
}

function agentCwd(): string {
  const dir = path.join(path.dirname(config.databasePath), 'agent');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class CliProvider implements AIProvider {
  readonly id = 'cli';
  private bin: string;

  constructor(bin?: string) {
    const resolved = bin ?? resolveCliBin();
    if (!resolved) {
      throw new Error(
        'Claude Code CLI 를 찾지 못했습니다. 설치 후 로그인하거나(claude), 설정에서 API 키(BYOK) 모드로 전환하세요.',
      );
    }
    this.bin = resolved;
  }

  async *streamChat(params: StreamParams): AsyncIterable<string> {
    const system = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const prompt = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n');

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--max-turns', '1',
      '--model', cliModel(params.model),
      '--setting-sources', '',
    ];
    if (system) args.push('--system-prompt', system, '--exclude-dynamic-system-prompt-sections');

    const child = spawn(this.bin, args, {
      cwd: agentCwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (params.signal) {
      const onAbort = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
      if (params.signal.aborted) onAbort();
      else params.signal.addEventListener('abort', onAbort, { once: true });
    }

    let stderrTail = '';
    child.stderr.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-2000);
    });

    let buffer = '';
    let sawDelta = false;
    let fallbackText = '';
    let resultError: string | null = null;

    const lines: string[] = [];
    let resolveMore: (() => void) | null = null;
    let done = false;
    let spawnError: Error | null = null;

    child.stdout.on('data', (c: Buffer) => {
      buffer += c.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) if (p.trim()) lines.push(p);
      resolveMore?.();
    });
    child.on('error', (e) => { spawnError = e; done = true; resolveMore?.(); });
    child.on('close', () => { if (buffer.trim()) lines.push(buffer); done = true; resolveMore?.(); });

    while (!done || lines.length) {
      if (!lines.length) {
        await new Promise<void>((res) => { resolveMore = res; });
        resolveMore = null;
        continue;
      }
      const line = lines.shift()!;
      const delta = deltaFromLine(line);
      if (delta !== null) {
        sawDelta = true;
        yield delta;
        continue;
      }
      const full = textFromAssistantLine(line);
      if (full !== null) fallbackText += full;
      resultError = resultError ?? errorFromResultLine(line);
    }

    if (spawnError) throw new Error(`agent CLI 실행 실패: ${(spawnError as Error).message}`);
    if (resultError) throw new Error(actionableCliError(resultError));
    if (!sawDelta && fallbackText) yield fallbackText;
    if (!sawDelta && !fallbackText && child.exitCode !== 0) {
      throw new Error(
        actionableCliError(`agent CLI 종료 코드 ${child.exitCode}: ${stderrTail.slice(-300)}`),
      );
    }
  }

  async testConnection(_model: string): Promise<TestResult> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* gone */ }
        resolve({ ok: false, detail: 'CLI 응답 시간 초과' });
      }, 5000);
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { ok: true, detail: out.trim() } : { ok: false, detail: `종료 코드 ${code}` });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: (e as Error).message });
      });
    });
  }
}
