// Drafting MCP 서버 (stdio) — 에이전트가 앱 밖에서 기획 문서를 만들고 내보내는 통로.
// 실행: npm run mcp 또는 node --experimental-strip-types api/src/mcp.ts
// DB 는 서버와 동일한 config.databasePath (환경변수 DATABASE_PATH 로 교체 가능).
// 모든 도구는 서비스 계층 직결(in-process) — HTTP 서버 없이 단독 동작한다.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './lib/config.ts';
import { getDb } from './db/index.ts';
import * as repo from './db/repos.ts';
import { documentToMarkdown } from './lib/render.ts';
import { lintReport } from './lib/lint-service.ts';
import type { DocumentType } from './lib/types.ts';

const DOC_TYPES = ['prd', 'feature-spec', 'ia', 'user-flow', 'design-system'] as const;

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] };
}

function fail(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** MCP 로 콘텐츠가 실린 문서를 앱 작성분과 동일하게 승격한다(draft → ready, version >= 1). */
function promoteDocument(id: string): void {
  const d = repo.getDocument(id);
  if (!d) return;
  if (d.status === 'draft') repo.setDocumentStatus(id, 'ready');
  if (d.version === 0) {
    getDb().prepare('UPDATE documents SET version = 1 WHERE id = ? AND version = 0').run(id);
  }
}

function docSummary(d: { id: string; type: string; title: string; status: string }) {
  return { id: d.id, type: d.type, title: d.title, status: d.status };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'drafting', version: config.version ?? '0.0.0' });

  server.tool(
    'drafting-list-projects',
    '기획 프로젝트 목록을 반환한다.',
    {},
    () => json({ projects: repo.listProjects().map((p) => ({ id: p.id, name: p.name, description: p.description })) }),
  );

  server.tool(
    'drafting-create-project',
    '새 기획 프로젝트를 만든다. 반환된 id 로 문서를 추가한다.',
    { name: z.string().min(1).describe('프로젝트 이름'), description: z.string().optional() },
    ({ name, description }) => {
      const p = repo.createProject(name, description ?? '');
      return json({ id: p.id, name: p.name });
    },
  );

  server.tool(
    'drafting-list-documents',
    '프로젝트의 문서 목록(id·type·title·status)을 반환한다.',
    { projectId: z.string() },
    ({ projectId }) => {
      if (!repo.getProject(projectId)) return fail('project not found');
      return json({ documents: repo.listDocuments(projectId).map(docSummary) });
    },
  );

  server.tool(
    'drafting-create-document',
    '프로젝트에 기획 문서를 만든다. type: prd | feature-spec | ia | user-flow | design-system. 내용은 drafting-add-section 으로 채운다.',
    {
      projectId: z.string(),
      type: z.enum(DOC_TYPES),
      title: z.string().min(1),
      parentDocumentId: z.string().optional().describe('파생 문서일 때 부모 문서 id'),
    },
    ({ projectId, type, title, parentDocumentId }) => {
      if (!repo.getProject(projectId)) return fail('project not found');
      // 문서 체인 강제: PRD 외 문서는 부모에서 파생된다 (interview → PRD → feature-spec → IA → user-flow).
      if (type !== 'prd' && !parentDocumentId) {
        return fail(
          `'${type}' 문서는 parentDocumentId 가 필요합니다 — 문서 체인(PRD → feature-spec → IA → user-flow)을 따라 이전 문서에서 파생시키세요.`,
        );
      }
      if (parentDocumentId && !repo.getDocument(parentDocumentId)) return fail('parent document not found');
      const d = repo.createDocument({
        projectId,
        type: type as DocumentType,
        title,
        parentDocumentId: parentDocumentId ?? null,
      });
      return json(docSummary(d));
    },
  );

  server.tool(
    'drafting-add-section',
    '문서에 섹션(heading + 마크다운 body)을 순서대로 추가한다. 추가 즉시 수락 상태로 문서 본문이 된다.',
    {
      documentId: z.string(),
      heading: z.string().min(1).describe('섹션 제목 (## 레벨)'),
      body: z.string().min(1).describe('섹션 본문 마크다운'),
    },
    ({ documentId, heading, body }) => {
      if (!repo.getDocument(documentId)) return fail('document not found');
      const s = repo.createSection(documentId, heading, body);
      promoteDocument(documentId); // 앱 작성분과 동일한 상태로(#92 후속)
      return json({ id: s.id, position: s.position, heading: s.heading });
    },
  );

  server.tool(
    'drafting-add-item',
    '구조 문서(feature-spec·ia·user-flow)에 실제 구조 항목을 추가한다 — 기능명세는 feature-group(기능군)→feature(개별 기능, F-nn 자동 채번), IA 는 page, 유저플로우는 flow→step. ref 번호는 서버가 채번한다. 산문 섹션이 아니라 이 항목들이 기획 컴파일(참조 무결성)의 검사 대상이다.',
    {
      documentId: z.string(),
      kind: z.enum(['feature-group', 'feature', 'page', 'flow', 'step']),
      title: z.string().min(1),
      body: z.string().optional().describe('설명·수용 기준 등 마크다운'),
      parentItemId: z.string().optional().describe('feature 는 feature-group, step 은 flow 의 항목 id'),
    },
    ({ documentId, kind, title, body, parentItemId }) => {
      const d = repo.getDocument(documentId);
      if (!d) return fail('document not found');
      const item = repo.createItem({
        documentId,
        kind,
        title,
        body: body ?? '',
        parentId: parentItemId ?? null,
        status: 'accepted',
      });
      promoteDocument(documentId);
      return json({ id: item.id, ref: item.ref_id, kind: item.kind, title: item.title });
    },
  );

  server.tool(
    'drafting-list-items',
    '구조 문서의 항목 트리(ref·kind·title·parent)를 반환한다.',
    { documentId: z.string() },
    ({ documentId }) => {
      if (!repo.getDocument(documentId)) return fail('document not found');
      const items = repo.listItems(documentId).map((i) => ({
        id: i.id, ref: i.ref_id, kind: i.kind, title: i.title, parent: i.parent_id,
      }));
      return json({ items });
    },
  );

  server.tool(
    'drafting-read-document',
    '문서 전체(섹션 포함)를 마크다운으로 반환한다.',
    { documentId: z.string() },
    ({ documentId }) => {
      const d = repo.getDocument(documentId);
      if (!d) return fail('document not found');
      return json({ ...docSummary(d), markdown: documentToMarkdown(documentId) });
    },
  );

  server.tool(
    'drafting-compile',
    '기획 컴파일 — 프로젝트의 참조 무결성 검사(lint) 리포트를 반환한다. gatePasses 가 true 면 출하 가능.',
    { projectId: z.string() },
    ({ projectId }) => {
      if (!repo.getProject(projectId)) return fail('project not found');
      const r = lintReport(projectId);
      return json({
        effectiveCount: r.effectiveCount,
        waivedCount: r.waivedCount,
        gatePasses: r.gatePasses,
        violations: r.violations.filter((v) => !v.waived).slice(0, 20),
      });
    },
  );

  server.tool(
    'drafting-export-project',
    '프로젝트의 문서 체인 전체(PRD→파생 순서)를 하나의 마크다운 합본으로 내보내고 절대 경로를 반환한다.',
    { projectId: z.string() },
    ({ projectId }) => {
      const project = repo.getProject(projectId);
      if (!project) return fail('project not found');
      const docs = repo.listDocuments(projectId);
      if (docs.length === 0) return fail('no documents');
      // 체인 순서: 부모 없는 문서(PRD)부터 BFS
      const byParent = new Map<string | null, typeof docs>();
      for (const d of docs) {
        const k = d.parent_document_id ?? null;
        byParent.set(k, [...(byParent.get(k) ?? []), d]);
      }
      const ordered: typeof docs = [];
      const queue = [...(byParent.get(null) ?? [])];
      while (queue.length) {
        const d = queue.shift()!;
        ordered.push(d);
        queue.push(...(byParent.get(d.id) ?? []));
      }
      const parts = ordered.map((d) => documentToMarkdown(d.id));
      const dir = path.join(path.dirname(config.databasePath), 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const slug = project.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project';
      const file = path.join(dir, `${slug}-set-${project.id.slice(0, 6)}.md`);
      fs.writeFileSync(file, parts.join('\n\n---\n\n'), 'utf8');
      return json({ path: file, documents: ordered.map((d) => `${d.type}: ${d.title}`) });
    },
  );

  server.tool(
    'drafting-export',
    '문서를 마크다운 파일로 내보낸다. 데이터 폴더의 exports/ 에 쓰고 절대 경로를 반환한다.',
    { documentId: z.string() },
    ({ documentId }) => {
      const d = repo.getDocument(documentId);
      if (!d) return fail('document not found');
      const dir = path.join(path.dirname(config.databasePath), 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const slug = d.title.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'document';
      const file = path.join(dir, `${slug}-${d.id.slice(0, 6)}.md`);
      fs.writeFileSync(file, documentToMarkdown(documentId), 'utf8');
      return json({ path: file, sections: repo.listSections(documentId).length });
    },
  );

  return server;
}

// stdio 엔트리 (테스트에서 import 만 할 때는 붙지 않도록 가드)
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  getDb(); // 스키마 부트스트랩
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
}
