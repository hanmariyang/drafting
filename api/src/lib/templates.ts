import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import type { InterviewTemplate, DocumentType } from './types.ts';

// Interview templates live as external JSON files (G-06: NOT hardcoded), so the
// community can add/edit document types without touching source. Loaded once at
// boot; call reloadTemplates() to pick up file changes.
let cache: Map<string, InterviewTemplate> | null = null;

export function loadTemplates(): Map<string, InterviewTemplate> {
  if (cache) return cache;
  return reloadTemplates();
}

export function reloadTemplates(): Map<string, InterviewTemplate> {
  const map = new Map<string, InterviewTemplate>();
  const dir = config.templatesDir;
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        const tpl = JSON.parse(raw) as InterviewTemplate;
        if (tpl.id && tpl.docType && Array.isArray(tpl.questions)) {
          map.set(tpl.id, tpl);
        }
      } catch {
        // skip malformed template file
      }
    }
  }
  cache = map;
  return map;
}

export function listTemplates(): InterviewTemplate[] {
  return [...loadTemplates().values()].sort((a, b) => a.docType.localeCompare(b.docType));
}

export function getTemplate(id: string): InterviewTemplate | null {
  return loadTemplates().get(id) ?? null;
}

export function getTemplateForType(docType: DocumentType): InterviewTemplate | null {
  for (const t of loadTemplates().values()) {
    if (t.docType === docType) return t;
  }
  return null;
}
