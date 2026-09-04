import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendChatLog, queryChatLogs } from "./store.js";
import { getDb, migrate, closeDb } from "../db/index.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-logstore-"));
  process.env.WB_DB_PATH = path.join(dir, "t.db");
  process.env.WB_LOG_DIR = path.join(dir, "logs");
  migrate(getDb());
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WB_DB_PATH;
  delete process.env.WB_LOG_DIR;
});

describe("appendChatLog / queryChatLogs", () => {
  it("stores and filters Q&A logs", () => {
    appendChatLog({ userId: "cli:local", channel: "cli", role: "user", content: "你好", traceId: "t1" });
    appendChatLog({ userId: "cli:local", channel: "cli", role: "assistant", content: "你好，我是助手", tokens: 42, traceId: "t1" });
    appendChatLog({ userId: "wecom:amy", channel: "wecom", role: "user", content: "查订单" });

    const mine = queryChatLogs({ userId: "cli:local" }) as { role: string; content: string }[];
    expect(mine).toHaveLength(2);
    expect(mine[0].role).toBe("assistant");  // DESC：最新的在前

    const byChannel = queryChatLogs({ channel: "wecom" }) as { user_id: string }[];
    expect(byChannel).toHaveLength(1);
    expect(byChannel[0].user_id).toBe("wecom:amy");
  });

  it("writes JSONL backup file", () => {
    appendChatLog({ userId: "cli:local", channel: "cli", role: "user", content: "备份检查" });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const file = path.join(process.env.WB_LOG_DIR!, `chat-${day}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]) as { content: string };
    expect(last.content).toBe("备份检查");
  });
});
