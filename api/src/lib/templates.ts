import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { getSetting, setSetting } from '../db/repos.ts';
import type { InterviewTemplate, DocumentType } from './types.ts';

// Interview templates live as external JSON files (G-06: NOT hardcoded), so the
// community can add/edit document types without touching source. Loaded once at
// boot. Custom templates (edited in-app) are stored in the DB and overlaid on
// top of the file templates by id — so users can customize without file edits.
let fileCache: Map<string, InterviewTemplate> | null = null;

function loadFileTemplates(): Map<string, InterviewTemplate> {
  if (fileCache) return fileCache;
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
  fileCache = map;
  return map;
}

function customStore(): Record<string, InterviewTemplate> {
  return getSetting<Record<string, InterviewTemplate>>('custom_templates') ?? {};
}

/** File templates with DB custom templates overlaid (custom wins by id). */
function effectiveTemplates(): Map<string, InterviewTemplate> {
  const map = new Map(loadFileTemplates());
  for (const [id, t] of Object.entries(customStore())) map.set(id, t);
  return map;
}

/** source of an id in the effective set — for the UI. */
export function templateSource(id: string): 'file' | 'custom' | 'override' {
  const isCustom = id in customStore();
  const isFile = loadFileTemplates().has(id);
  if (isCustom && isFile) return 'override';
  return isCustom ? 'custom' : 'file';
}

export function loadTemplates(): Map<string, InterviewTemplate> {
  return effectiveTemplates();
}

export function listTemplates(): InterviewTemplate[] {
  return [...effectiveTemplates().values()].sort((a, b) => a.docType.localeCompare(b.docType));
}

export function getTemplate(id: string): InterviewTemplate | null {
  return effectiveTemplates().get(id) ?? null;
}

export function getTemplateForType(docType: DocumentType): InterviewTemplate | null {
  for (const t of effectiveTemplates().values()) {
    if (t.docType === docType) return t;
  }
  return null;
}

// ── custom template mutations (in-app editor) ────────────────────────────────
export function saveCustomTemplate(t: InterviewTemplate): void {
  const store = customStore();
  store[t.id] = t;
  setSetting('custom_templates', store);
}

/** Delete a custom template. For an override, this reverts to the file version. */
export function deleteCustomTemplate(id: string): boolean {
  const store = customStore();
  if (!(id in store)) return false;
  delete store[id];
  setSetting('custom_templates', store);
  return true;
}
