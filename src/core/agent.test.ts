import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---- SDK 打桩：拦截对 @tencent-ai/agent-sdk 的 import ----
const calls: Array<{ prompt: string; resume?: string; cwd?: string }> = [];
let nextSessionId = "sess-1";

vi.mock("@tencent-ai/agent-sdk", () => ({
  query: ({ prompt, options }: { prompt: string; options: { resume?: string; cwd?: string } }) => {
    calls.push({ prompt, resume: options.resume, cwd: options.cwd });
    const sessionId = options.resume ? `same-session` : nextSessionId;
    const messages = [
      { type: "system", subtype: "init", session_id: sessionId },
      { type: "assistant", message: { content: [{ type: "text", text: `答:${prompt}` }] } },
      { type: "result", duration_ms: 5 },
    ];
    return (async function* () { yield* messages; })();
  },
}));

const { createRealAgentRunner } = await import("./real-agent.js");
const { loadUserSession, saveUserSession, workspaceFor } = await import("./agent.js");
const { getDb, migrate, closeDb } = await import("../db/index.js");

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-agent-"));
  process.env.WB_DB_PATH = path.join(dir, "t.db");
  process.env.WB_WORKSPACES_DIR = path.join(dir, "ws");
  process.env.WB_LOG_DIR = path.join(dir, "logs");
  migrate(getDb());
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WB_DB_PATH;
  delete process.env.WB_WORKSPACES_DIR;
  delete process.env.WB_LOG_DIR;
});

const mkMsg = (userId: string, text: string) => ({
  channel: "cli", userId, text, msgId: `m-${Math.random()}`, traceId: "t",
});

describe("real-agent (SDK stubbed)", () => {
  it("first chat creates session, second resumes it (context preserved)", async () => {
    const runner = await createRealAgentRunner();
    const r1 = await runner.chat(mkMsg("u1", "今年是哪一年?"), async () => {});
    expect(r1).toBe("答:今年是哪一年?");
    expect(calls[0].resume).toBeUndefined();

    const r2 = await runner.chat(mkMsg("u1", "再往后推 10 年?"), async () => {});
    expect(r2).toBe("答:再往后推 10 年?");
    expect(calls[1].resume).toBe("sess-1");           // SC2：会话恢复
  });

  it("different users get isolated cwd workspaces (SC3)", async () => {
    const runner = await createRealAgentRunner();
    await runner.chat(mkMsg("alice", "hi"), async () => {});
    await runner.chat(mkMsg("bob", "hi"), async () => {});
    const a = loadUserSession("alice");
    const b = loadUserSession("bob");
    expect(a.cwd).not.toBe(b.cwd);
    expect(a.cwd).toContain("alice");
    expect(b.cwd).toContain("bob");
  });

  it("persists session mapping to user_sessions table", () => {
    const row = getDb().prepare("SELECT session_id FROM user_sessions WHERE user_id='u1'").get() as { session_id: string };
    expect(row.session_id).toBe("same-session");
  });

  it("workspaceFor sanitizes unsafe user ids", () => {
    const dir2 = workspaceFor("wecom:张三/恶意");
    expect(path.basename(dir2)).not.toMatch(/[/\\]/);
  });
});

export { saveUserSession };
