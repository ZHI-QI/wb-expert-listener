/**
 * AgentRunner — @tencent-ai/agent-sdk 适配层。
 *
 * 设计约束：
 * - SDK 的 v2 Session API 带 unstable_ 前缀，所有 SDK 细节封死在本文件，
 *   上层（dispatcher / session-pool）只依赖本模块导出的窄接口。
 * - allowedTools 白名单收口：只读工具 + 脚本库 MCP；永不放行 Bash/Write/Edit。
 */

import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { traceLogger } from "../log/logger.js";
import type { IncomingMessage } from "../channels/base.js";
import { appendChatLog } from "../log/store.js";

/** 窄接口：上层唯一依赖。真实实现（real-agent.ts）与测试桩（stub）都实现它。 */
export interface AgentRunner {
  /** 多轮对话：按 userId 路由/创建会话，返回最终回答文本。 */
  chat(msg: IncomingMessage, onProgress: (text: string) => Promise<void>): Promise<string>;
  /** 供会话池调用：重建该用户的 SDK 会话句柄。 */
  ensureSession(userId: string, userName?: string): Promise<{ sessionId: string; cwd: string }>;
}

export const READONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/** user_id → workspace 目录（天然隔离各用户文件操作）。Windows 盘符冒号等非法字符全部替换。 */
export function workspaceFor(userId: string): string {
  const cfg = getConfig();
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  const dir = require("node:path").join(cfg.workspacesDir, safe) as string;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 从 user_sessions 读取（或初始化）该用户的会话记录。 */
export function loadUserSession(userId: string): { sessionId: string | null; cwd: string } {
  const db = getDb();
  const row = db.prepare("SELECT session_id, cwd FROM user_sessions WHERE user_id = ?").get(userId) as
    | { session_id: string; cwd: string }
    | undefined;
  return { sessionId: row?.session_id ?? null, cwd: row?.cwd ?? workspaceFor(userId) };
}

export function saveUserSession(userId: string, sessionId: string, cwd: string): void {
  getDb()
    .prepare(
      `INSERT INTO user_sessions (user_id, session_id, cwd, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET session_id = excluded.session_id, cwd = excluded.cwd, updated_at = datetime('now')`,
    )
    .run(userId, sessionId, cwd);
}

/** 统计该用户日志条数（用于自动总结的每10轮触发，Task 11 使用）。 */
export function chatTurnCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM chat_logs WHERE user_id = ? AND role = 'user'")
    .get(userId) as { n: number };
  return row.n;
}

export { appendChatLog, traceLogger };
