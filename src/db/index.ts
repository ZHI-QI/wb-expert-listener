import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

let db: DB | null = null;

/** Open (or return existing) SQLite handle in WAL mode. */
export function getDb(dbPath?: string): DB {
  if (db) return db;
  const p = dbPath ?? process.env.WB_DB_PATH ?? path.resolve(__dirname, "../../data/app.db");
  db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Run schema.sql idempotently (CREATE IF NOT EXISTS everywhere). */
export function migrate(database: DB = getDb()): void {
  const sql = readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
  database.exec(sql);
}

/** Close handle (mainly for tests). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
