/**
 * summary.ts — 自动问题总结（SC11）。
 * 触发：① 用户会话空闲 30min（视为结束）② 每 10 轮问答。
 * 产出：分类 + 摘要 + 是否解决 → summaries 表；FAQ 候选标记。
 * LLM 调用经 deps 注入（默认用 AgentRunner 冷路径 query；测试可打桩）。
 */
import { getDb } from "../db/index.js";
import { traceLogger } from "../log/logger.js";

export interface SummaryDeps {
  /** 用 LLM 生成总结：输入对话文本，输出 JSON {category, summary, resolved}。 */
  summarize(dialogText: string): Promise<{ category: string; summary: string; resolved: boolean }>;
}

export interface Turn {
  role: string;
  content: string;
  created_at: string;
}

/** 拉取某用户最近 N 条问答记录拼成对话文本。 */
export function loadDialog(userId: string, limit = 20): Turn[] {
  const rows = getDb()
    .prepare(
      `SELECT role, content, created_at FROM chat_logs
       WHERE user_id = ? AND role IN ('user','assistant')
       ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, limit) as Turn[];
  return rows.reverse();
}

export function saveSummary(userId: string, sessionId: string, s: { category: string; summary: string; resolved: boolean }): void {
  getDb()
    .prepare("INSERT INTO summaries (user_id, session_id, category, summary, resolved) VALUES (?, ?, ?, ?, ?)")
    .run(userId, sessionId, s.category, s.summary, s.resolved ? 1 : 0);
}

/** 用户轮数达到 10 的倍数？ */
export function shouldSummarizeByTurns(userId: string, every = 10): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM chat_logs WHERE user_id = ? AND role = 'user'")
    .get(userId) as { n: number };
  return row.n > 0 && row.n % every === 0;
}

/** 主入口：生成并存档总结（幂等：同一 sessionId+轮次只存一次由调用方保证）。 */
export async function summarizeUser(userId: string, sessionId: string, deps: SummaryDeps): Promise<void> {
  const log = traceLogger("summary", { userId });
  const dialog = loadDialog(userId);
  if (dialog.length < 2) return; // 至少一问一答

  const text = dialog.map((t) => `${t.role === "user" ? "用户" : "助手"}: ${t.content}`).join("\n");
  try {
    const s = await deps.summarize(text);
    saveSummary(userId, sessionId, s);
    log.info({ category: s.category, resolved: s.resolved }, "summary saved");
  } catch (err) {
    log.warn({ err }, "summarize failed (non-fatal)");
  }
}

/** 空闲检测器：每分钟扫一次，30min 无活动则触发总结。 */
export function startIdleSummarizer(
  getSessionId: (userId: string) => string | null,
  deps: SummaryDeps,
  idleMs = 30 * 60_000,
): () => void {
  const summarized = new Set<string>(); // userId@lastLogId，防重复
  const timer = setInterval(async () => {
    const users = getDb()
      .prepare(
        `SELECT user_id, MAX(id) AS last_id, MAX(created_at) AS last_at
         FROM chat_logs WHERE role='user' GROUP BY user_id`,
      )
      .all() as { user_id: string; last_id: number; last_at: string }[];
    const now = Date.now();
    for (const u of users) {
      const idleFor = now - new Date(u.last_at.replace(" ", "T") + "Z").getTime();
      const key = `${u.user_id}@${u.last_id}`;
      if (idleFor >= idleMs && !summarized.has(key)) {
        summarized.add(key);
        const sid = getSessionId(u.user_id) ?? "unknown";
        await summarizeUser(u.user_id, sid, deps).catch(() => {});
      }
    }
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
