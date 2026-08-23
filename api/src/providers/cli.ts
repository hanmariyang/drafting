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
import { getSetting } from '../db/repos.ts';
import type { AIProvider, StreamParams, TestResult } from './types.ts';

const HOME = os.homedir();

/** 설치 관리자와 무관한 표준 위치들(존재하면 바로 사용). */
const FIXED_CANDIDATES = [
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(HOME, '.local', 'bin', 'claude'),
  path.join(HOME, '.claude', 'local', 'claude'),
  path.join(HOME, '.volta', 'bin', 'claude'),
  path.join(HOME, '.asdf', 'shims', 'claude'),
];

function safeExists(p: string): boolean {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

/** semver-ish 문자열 내림차순 비교 (최신 노드 버전 우선). */
function cmpVersionDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * nvm·fnm·asdf·n 처럼 노드 버전 디렉터리 안에 claude 를 심는 매니저를 글롭한다.
 * GUI 앱은 이 경로들을 PATH 로 못 보므로 직접 훑는다. 버전이 여럿이면 최신을 앞에.
 * 순수하게 테스트하도록 home 을 주입 가능.
 */
export function nodeManagerBins(home = HOME): string[] {
  const roots: { dir: string; suffix: string[] }[] = [
    { dir: path.join(home, '.nvm', 'versions', 'node'), suffix: ['bin', 'claude'] },
    { dir: path.join(home, '.fnm', 'node-versions'), suffix: ['installation', 'bin', 'claude'] },
    { dir: path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), suffix: ['installation', 'bin', 'claude'] },
    { dir: path.join(home, '.asdf', 'installs', 'nodejs'), suffix: ['bin', 'claude'] },
    { dir: path.join(home, 'n', 'versions', 'node'), suffix: ['bin', 'claude'] },
  ];
  const out: string[] = [];
  for (const { dir, suffix } of roots) {
    let versions: string[];
    try { versions = fs.readdirSync(dir); } catch { continue; }
    versions.sort(cmpVersionDesc);
    for (const v of versions) {
      const p = path.join(dir, v, ...suffix);
      if (safeExists(p)) out.push(p);
    }
  }
  return out;
}

/** 설정에 저장된 수동 경로(최우선). DB 미초기화(테스트)면 조용히 무시. */
function settingBin(): string {
  try {
    const v = getSetting<string>('agent_bin_path');
    return typeof v === 'string' ? v.trim() : '';
  } catch { return ''; }
}

let cachedBin: string | null | undefined;

/**
 * claude 바이너리를 찾는다. 우선순위:
 *   1) 설정 수동 경로 → 2) DRAFTING_AGENT_BIN → 3) PATH(which) →
 *   4) 표준 위치 → 5) 노드 버전 매니저(nvm/fnm/asdf/n) 글롭
 * GUI 앱은 셸 PATH 를 못 물려받으므로 4·5 의 직접 탐색이 핵심이다.
 */
export function resolveCliBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  for (const cand of [settingBin(), (process.env.DRAFTING_AGENT_BIN ?? '').trim()]) {
    if (safeExists(cand)) return (cachedBin = cand);
  }
  const onPath = spawnSync('which', ['claude'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return (cachedBin = onPath.stdout.trim());
  for (const cand of FIXED_CANDIDATES) {
    if (safeExists(cand)) return (cachedBin = cand);
  }
  const managed = nodeManagerBins();
  if (managed.length) return (cachedBin = managed[0]);
  return (cachedBin = null);
}

export function cliAvailable(): boolean {
  return resolveCliBin() !== null;
}

/** 세션 캐시 무효화 (설정에서 경로를 바꾼 직후 등) */
export function resetCliBinCache(): void {
  cachedBin = undefined;
}

/**
 * CLI 스폰용 env. GUI 앱의 빈약한 PATH 로는 nvm/fnm 의 claude 셔뱅
 * (`#!/usr/bin/env node`)이 node 를 못 찾아 실패한다 → 바이너리와 같은 dir
 * (그 안에 node 가 함께 있다) + 표준 위치를 PATH 앞에 얹는다. 테스트 가능하도록 분리.
 */
export function cliSpawnEnv(bin: string, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const prepend = [
    path.dirname(bin),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(HOME, '.local', 'bin'),
    '/usr/bin',
    '/bin',
  ];
  const existing = baseEnv.PATH ? baseEnv.PATH.split(path.delimiter) : [];
  const seen = new Set<string>();
  const merged = [...prepend, ...existing].filter((d) => d && !seen.has(d) && seen.add(d));
  return { ...baseEnv, PATH: merged.join(path.delimiter) };
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

export interface CliAccess {
  /** 실제 생성 권한까지 확인됨 (온보딩에서 '키 없이 시작' 허용 신호) */
  ok: boolean;
  /** 로그인은 됐지만 조직이 Claude Code 접근을 막았거나 인증이 거부됨 → BYOK 로 유도 */
  blocked: boolean;
  detail: string;
}

const AUTH_BLOCK_RE =
  /disabled Claude subscription|subscription access|API key instead|log ?in|not logged|authenticat|OAuth|credential|invalid API key|unauthorized|401|403/i;

/**
 * `--version`(존재 확인)을 넘어 실제 생성 권한을 검증한다. 조직이 Claude Code
 * 구독 접근을 끈 계정은 CLI 가 설치·로그인돼 있어도 첫 생성에서 거부되므로,
 * 온보딩에서 '키 없이 시작'을 누르는 즉시 이 검증으로 미리 잡아 BYOK 로 보낸다.
 * 검증용 최소 프롬프트 + haiku 로 토큰을 아낀다.
 */
export async function verifyCliAccess(binOverride?: string): Promise<CliAccess> {
  const bin = binOverride ?? resolveCliBin();
  if (!bin) {
    return { ok: false, blocked: false, detail: 'Claude Code CLI 를 찾지 못했습니다 (claude 설치·로그인 필요)' };
  }
  return new Promise<CliAccess>((resolve) => {
    const child = spawn(
      bin,
      ['-p', '응답으로 OK 한 단어만 출력', '--output-format', 'json', '--max-turns', '1', '--model', 'haiku', '--setting-sources', ''],
      { cwd: agentCwd(), env: cliSpawnEnv(bin), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      resolve({ ok: false, blocked: false, detail: 'CLI 응답 시간 초과 — 네트워크·로그인 상태를 확인하세요.' });
    }, 30000);
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, blocked: false, detail: `CLI 실행 실패: ${(e as Error).message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let isErr = false;
      let resultText = '';
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const ev = JSON.parse(t) as { type?: string; is_error?: boolean; result?: string };
          if (ev.type === 'result') { isErr = !!ev.is_error; resultText = ev.result ?? ''; }
        } catch { /* not json */ }
      }
      const combined = `${resultText}\n${err}`;
      const blocked = AUTH_BLOCK_RE.test(combined);
      if (code === 0 && !isErr && !blocked) {
        return resolve({ ok: true, blocked: false, detail: 'Claude Code 생성 권한 확인됨' });
      }
      resolve({ ok: false, blocked, detail: actionableCliError(resultText || err || `CLI 종료 코드 ${code}`) });
    });
  });
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
      env: cliSpawnEnv(this.bin),
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
      const child = spawn(this.bin, ['--version'], { env: cliSpawnEnv(this.bin), stdio: ['ignore', 'pipe', 'pipe'] });
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
