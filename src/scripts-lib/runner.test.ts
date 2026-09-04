import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScript } from "./runner.js";
import { watchScripts, auditScriptEvent } from "./watcher.js";
import { getDb, migrate, closeDb } from "../db/index.js";
import { sleep } from "../common.js";

let dir: string;
let scriptsDir: string;

const PY = process.platform === "win32" ? "python" : "python3";

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-scripts-"));
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

describe("runner", () => {
  it("runs a quick python script and captures utf-8 output", async () => {
    const f = path.join(dir, "hello.py");
    writeFileSync(f, "# -*- coding: utf-8 -*-\nprint('你好 world')\n", "utf-8");
    const r = await runScript(f, [], 15_000);
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("你好");
  }, 30_000);

  it("kills the process on timeout", async () => {
    const f = path.join(dir, "slow.py");
    writeFileSync(f, "import time\ntime.sleep(10)\n", "utf-8");
    const r = await runScript(f, [], 1_500);
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.durationMs).toBeLessThan(5_000);
  }, 20_000);
});

describe("watcher + audit", () => {
  it("audits add/modify/remove events to script_audit table", async () => {
    scriptsDir = path.join(dir, "scripts");
    mkdirSync(scriptsDir);
    const stop = watchScripts(scriptsDir);
    await sleep(1_200); // chokidar 初始化扫描

    const f = path.join(scriptsDir, "a.py");
    writeFileSync(f, "print(1)", "utf-8");
    await sleep(900);
    writeFileSync(f, "print(2)", "utf-8");
    await sleep(900);
    rmSync(f);
    await sleep(900);
    stop();

    const rows = getDb()
      .prepare("SELECT event FROM script_audit ORDER BY id")
      .all() as { event: string }[];
    const events = rows.map((r) => r.event);
    expect(events).toContain("add");
    expect(events).toContain("modify");
    expect(events).toContain("remove");
  }, 20_000);

  it("db_query.py enforces read-only policy (SC7 前置)", async () => {
    // 直接调 python 验证白名单逻辑（不经 uv，测试环境可能无 uv）
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const f = path.resolve(here, "../../scripts/db_query.py");
    const bad = spawnSync(PY, [f, "--sql", "DROP TABLE x"], { encoding: "utf-8", env: { ...process.env, DB_URL: "x.db" } });
    expect(bad.stdout + bad.stderr).toMatch(/only SELECT\/WITH|read-only|not allowed/i);
  }, 20_000);
});
