-- wb-expert-listener SQLite schema (WAL mode)
-- Migrations run idempotently at startup via src/db/migrate.ts

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS user_sessions (
  user_id    TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  cwd        TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  channel    TEXT NOT NULL,
  session_id TEXT,
  role       TEXT NOT NULL,          -- user | assistant | tool | system
  content    TEXT NOT NULL,
  tokens     INTEGER,
  trace_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user  ON chat_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_time  ON chat_logs(created_at);

CREATE TABLE IF NOT EXISTS summaries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  category   TEXT,                   -- 问题分类
  summary    TEXT NOT NULL,          -- 摘要
  resolved   INTEGER DEFAULT 0,      -- 是否解决 0/1
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS script_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event      TEXT NOT NULL,          -- add | modify | remove
  script_name TEXT NOT NULL,
  old_hash   TEXT,
  new_hash   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
