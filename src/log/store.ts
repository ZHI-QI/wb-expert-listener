import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";

export interface ChatLogEntry {
  userId: string;
  channel: string;
  sessionId?: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tokens?: number;
  traceId?: string;
}

/** 问答落库（chat_logs）+ JSONL 双写备份（logs/chat-YYYYMMDD.jsonl）。 */
export function appendChatLog(entry: ChatLogEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO chat_logs (user_id, channel, session_id, role, content, tokens, trace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.userId,
    entry.channel,
    entry.sessionId ?? null,
    entry.role,
    entry.content,
    entry.tokens ?? null,
    entry.traceId ?? null,
  );

  try {
    const cfg = getConfig();
    mkdirSync(cfg.logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    appendFileSync(
      path.join(cfg.logDir, `chat-${day}.jsonl`),
      JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n",
      "utf-8",
    );
  } catch {
    // JSONL 备份失败不阻塞主链路；SQLite 是主存储
  }
}

export interface ChatLogFilter {
  userId?: string;
  channel?: string;
  since?: string;   // ISO date
  limit?: number;
}

export function queryChatLogs(filter: ChatLogFilter = {}) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("user_id = ?"); params.push(filter.userId); }
  if (filter.channel) { where.push("channel = ?"); params.push(filter.channel); }
  if (filter.since) { where.push("created_at >= ?"); params.push(filter.since); }
  const sql = `SELECT * FROM chat_logs ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY id DESC LIMIT ?`;
  params.push(filter.limit ?? 100);
  return db.prepare(sql).all(...params);
}
