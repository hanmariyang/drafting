import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.ts';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(config.schemaPath, 'utf8');
  db.exec(schema);
  migrate(db);
  return db;
}

/** Open an in-memory db for tests, applying the schema. */
export function openMemoryDb(): DatabaseSync {
  const mem = new DatabaseSync(':memory:');
  mem.exec('PRAGMA foreign_keys = ON;');
  mem.exec(fs.readFileSync(config.schemaPath, 'utf8'));
  migrate(mem);
  return mem;
}

/**
 * Idempotent, additive migrations for DBs created before a column existed.
 * The base schema uses CREATE TABLE IF NOT EXISTS, so pre-existing tables keep
 * their old shape — bring them forward here. Existing data is stub/demo only,
 * so we only add columns (no destructive rewrites). Any legacy section without
 * an explicit status is backfilled to 'accepted' so old demo docs still export.
 */
function migrate(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(sections)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'status')) {
    d.exec("ALTER TABLE sections ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'");
  }
  // v0.4: structure-doc suggestions target a plan_item. Add the column to
  // suggestions tables created before it existed (default NULL, no REFERENCES on
  // ADD COLUMN — the base schema carries the FK for fresh DBs).
  const sugCols = d.prepare('PRAGMA table_info(suggestions)').all() as Array<{ name: string }>;
  if (sugCols.length && !sugCols.some((c) => c.name === 'target_item_id')) {
    d.exec('ALTER TABLE suggestions ADD COLUMN target_item_id TEXT');
  }
}

export function setDb(instance: DatabaseSync): void {
  db = instance;
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
}

/** 전체 워크스페이스 스냅샷 — WAL 체크포인트 후 DB 파일 바이트를 반환한다. */
export function backupBytes(): Buffer {
  const d = getDb();
  try {
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* WAL 아닐 수 있음 */
  }
  return fs.readFileSync(config.databasePath);
}

/**
 * 업로드된 백업으로 DB 를 교체한다. 먼저 임시 파일로 열어 스키마를 검증(projects
 * 조회)한 뒤에만 라이브 DB 를 닫고 파일을 바꿔 다시 연다. 유효하지 않으면 원본 보존.
 */
export function restoreFromBytes(buf: Buffer): void {
  const target = config.databasePath;
  const tmp = `${target}.restore-tmp`;
  fs.writeFileSync(tmp, buf);
  try {
    const t = new DatabaseSync(tmp);
    t.prepare('SELECT count(*) AS n FROM projects').get(); // 우리 스키마가 아니면 throw
    t.close();
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error(`유효한 Drafting 백업이 아닙니다: ${(e as Error).message}`);
  }
  closeDb();
  // WAL/SHM 사이드카를 지워 새 본 파일과 섞이지 않게 한다.
  for (const ext of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(target + ext);
    } catch {
      /* 없을 수 있음 */
    }
  }
  fs.renameSync(tmp, target);
  getDb(); // 재오픈 + 마이그레이션
}

export function nowIso(): string {
  return new Date().toISOString();
}
