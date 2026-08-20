import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse } from './helpers.ts';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => {
    return repo.listProjects().map((p) => ({
      ...p,
      documentCount: repo.listDocuments(p.id).length,
    }));
  });

  app.post('/api/projects', async (req) => {
    const body = parse(
      z.object({ name: z.string().min(1), description: z.string().optional() }),
      req.body,
    );
    return repo.createProject(body.name, body.description ?? '');
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = repo.getProject(id);
    if (!project) throw new HttpError(404, 'project not found');
    // open_suggestions drives the tree green dot (SYSTEM.md §2).
    const documents = repo.listDocuments(id).map((d) => ({
      ...d,
      open_suggestions: repo.countOpenSuggestions(d.id),
    }));
    return { ...project, documents };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ name: z.string().min(1).optional(), description: z.string().optional() }),
      req.body,
    );
    const updated = repo.updateProject(id, body);
    if (!updated) throw new HttpError(404, 'project not found');
    return updated;
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    repo.deleteProject(id);
    return { ok: true };
  });

  // Dependency graph across the project's documents (SPEC-05)
  app.get('/api/projects/:id/graph', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    const docs = repo.listDocuments(id);
    return {
      nodes: docs.map((d) => ({
        id: d.id,
        type: d.type,
        title: d.title,
        status: d.status,
        contextStale: d.context_stale === 1,
      })),
      edges: docs
        .filter((d) => d.parent_document_id)
        .map((d) => ({ from: d.parent_document_id, to: d.id })),
    };
  });

  // Example plan for first-run onboarding: a sample chain with open suggestions
  // so the accept/reject grammar can be practiced on real UI (SYSTEM.md §4).
  app.post('/api/sample', async () => {
    const existing = repo.listProjects().find((p) => p.name === SAMPLE_NAME);
    if (existing) {
      const docs = repo.listDocuments(existing.id);
      return { project: existing, documentId: docs[0]?.id ?? null, created: false };
    }

    const project = repo.createProject(SAMPLE_NAME, '팀 지표를 매주 월요일 슬랙으로 요약');
    const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: '제품 요구사항' });

    repo.createSection(prd.id, '문제 정의', '팀 지표가 여러 대시보드에 흩어져 있어 주간 회의 준비에 매번 30분 이상 쓴다. 리더가 손으로 숫자를 모으는 동안 해석은 뒷전이 된다.');
    repo.createSection(prd.id, '목표', '매주 월요일 09:00, 지난주 핵심 지표 요약이 슬랙 채널에 자동 게시된다. 준비 시간 30분을 0분으로.');
    const scope = repo.createSection(prd.id, '범위', '1차 범위는 슬랙 게시 봇 하나. 지표 소스는 스프레드시트 1개로 시작한다.');
    repo.createSection(
      prd.id,
      '지표 이상 감지',
      '전주 대비 20% 이상 변동한 지표는 요약 상단에 따로 표시한다.',
      undefined,
      'proposed',
    );

    repo.createSuggestion({
      documentId: prd.id,
      kind: 'add',
      title: '이상 감지 섹션 추가',
      body: '인터뷰에서 "숫자보다 변화를 놓치는 게 무섭다"고 답했습니다. 급변 지표를 상단에 올리는 규칙을 제안합니다.',
      quoteAfter: '전주 대비 20% 이상 변동한 지표는 요약 상단에 따로 표시한다.',
      source: 'Q4',
    });
    repo.createSuggestion({
      documentId: prd.id,
      sectionId: scope.id,
      kind: 'revise',
      title: '범위에 제외 항목 명시',
      body: '범위 섹션에 "하지 않는 것"이 없으면 스코프가 새기 쉽습니다. 대시보드 UI는 만들지 않는다는 한 줄을 제안합니다.',
      quoteBefore: '1차 범위는 슬랙 게시 봇 하나. 지표 소스는 스프레드시트 1개로 시작한다.',
      quoteAfter: '1차 범위는 슬랙 게시 봇 하나. 지표 소스는 스프레드시트 1개로 시작하며, 별도 대시보드 UI는 만들지 않는다.',
      source: 'PRD §1',
    });
    repo.createSuggestion({
      documentId: prd.id,
      kind: 'question',
      title: '누락 확인',
      body: '요약을 받는 채널이 팀 공개 채널인가요, 리더 전용인가요? 답에 따라 지표 민감도 처리가 갈립니다.',
      source: 'PRD §2',
    });

    return { project, documentId: prd.id, created: true };
  });
}

const SAMPLE_NAME = '예시: 주간 리포트 봇';
