import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadDialog, saveSummary, shouldSummarizeByTurns, summarizeUser,
} from "./summary.js";
import { getDb, migrate, closeDb } from "../db/index.js";
import { appendChatLog } from "../log/store.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-summary-"));
  process.env.WB_DB_PATH = path.join(dir, "t.db");
  process.env.WB_LOG_DIR = path.join(dir, "logs");
  migrate(getDb());
});
afterAll(async () => {
  // 给 pino 异步目的地刷盘时间，避免删除临时目录后仍有 JSONL 写入
  await new Promise((r) => setTimeout(r, 300));
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WB_DB_PATH;
  delete process.env.WB_LOG_DIR;
});

describe("summary (SC11)", () => {
  it("summarizeUser saves LLM summary to summaries table", async () => {
    appendChatLog({ userId: "u1", channel: "cli", role: "user", content: "怎么开发票？" });
    appendChatLog({ userId: "u1", channel: "cli", role: "assistant", content: "订单页→更多→开票，填抬头即可。" });

    const calls: string[] = [];
    await summarizeUser("u1", "sess-1", {
      summarize: async (text) => {
        calls.push(text);
        return { category: "发票", summary: "用户咨询开票流程，已解答", resolved: true };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("怎么开发票？");
    const row = getDb().prepare("SELECT category, summary, resolved FROM summaries").get() as { category: string; resolved: number };
    expect(row.category).toBe("发票");
    expect(row.resolved).toBe(1);
  });

  it("skips when dialog too short (<2 turns)", async () => {
    appendChatLog({ userId: "u2", channel: "cli", role: "user", content: "只有一问" });
    let called = 0;
    await summarizeUser("u2", "s", { summarize: async () => { called++; return { category: "x", summary: "y", resolved: false }; } });
    expect(called).toBe(0);
  });

  it("shouldSummarizeByTurns fires every 10 user turns", () => {
    for (let i = 0; i < 9; i++) appendChatLog({ userId: "u3", channel: "cli", role: "user", content: `问${i}` });
    expect(shouldSummarizeByTurns("u3")).toBe(false); // 9条（u1那条是别的用户）——u3共9
    appendChatLog({ userId: "u3", channel: "cli", role: "user", content: "问10" });
    expect(shouldSummarizeByTurns("u3")).toBe(true);  // 10条整
  });

  it("loadDialog returns user+assistant turns in order", () => {
    const d = loadDialog("u1");
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d[0].role).toBe("user");
    expect(d[1].role).toBe("assistant");
  });

  it("saveSummary direct insert works", () => {
    saveSummary("u9", "s9", { category: "测试", summary: "直插", resolved: false });
    const row = getDb().prepare("SELECT summary FROM summaries WHERE user_id='u9'").get() as { summary: string };
    expect(row.summary).toBe("直插");
  });
});
