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

export function nowIso(): string {
  return new Date().toISOString();
}
