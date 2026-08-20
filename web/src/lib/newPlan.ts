import { api } from './api.ts';

/**
 * 아이디어 한 줄 → 프로젝트 + PRD 문서 + 인터뷰 세션까지 만들고
 * 착지할 문서 경로를 돌려준다. 이름은 아이디어에서 임시로 따고,
 * 범위·정식 이름은 인터뷰가 정리한다 (진입 재설계 시안 1·3).
 */
export async function startFromIdea(idea: string): Promise<string> {
  const line = idea.trim();
  const name = line.length > 40 ? `${line.slice(0, 40)}…` : line;
  const project = await api.createProject(name, line);
  const doc = await api.createDocument(project.id, { type: 'prd', title: '제품 요구사항' });
  try {
    await api.startInterview(doc.id);
  } catch {
    // 인터뷰 템플릿이 없어도 문서로는 착지한다 (빈 문서 = 인터뷰 모드 진입)
  }
  return `/projects/${project.id}/documents/${doc.id}`;
}

// ── 복원 착지 (시안 2) ────────────────────────────────────────────
const LAST_DOC_KEY = 'drafting.lastDoc';
const OPEN_MODE_KEY = 'drafting.openMode';

export interface LastDoc {
  pid: string;
  did: string;
  docTitle: string;
  projectName: string;
  ts: string;
}

export function rememberLastDoc(entry: LastDoc): void {
  try {
    localStorage.setItem(LAST_DOC_KEY, JSON.stringify(entry));
  } catch {
    /* storage unavailable */
  }
}

export function getLastDoc(): LastDoc | null {
  try {
    const raw = localStorage.getItem(LAST_DOC_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastDoc;
    return v && v.pid && v.did ? v : null;
  } catch {
    return null;
  }
}

export function forgetLastDoc(matchDid?: string): void {
  try {
    if (matchDid && getLastDoc()?.did !== matchDid) return;
    localStorage.removeItem(LAST_DOC_KEY);
  } catch {
    /* ignore */
  }
}

export type OpenMode = 'start' | 'resume';

/** 실행 시 착지: 시작 화면(기본) 또는 마지막 문서 복원. */
export function getOpenMode(): OpenMode {
  try {
    return localStorage.getItem(OPEN_MODE_KEY) === 'resume' ? 'resume' : 'start';
  } catch {
    return 'start';
  }
}

export function setOpenMode(mode: OpenMode): void {
  try {
    localStorage.setItem(OPEN_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}
