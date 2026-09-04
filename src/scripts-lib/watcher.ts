/**
 * watcher.ts — chokidar 监听 scripts/ 目录：新增/修改/删除 → 审计落库 + 管理员通知。
 * 这是用户明确要求的合规动作（spec 边界），不可省略。
 */
import chokidar from "chokidar";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { traceLogger } from "../log/logger.js";

type Event = "add" | "modify" | "remove";

export function hashFile(p: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

export function auditScriptEvent(event: Event, scriptName: string, oldHash: string | null, newHash: string | null): void {
  getDb()
    .prepare("INSERT INTO script_audit (event, script_name, old_hash, new_hash) VALUES (?, ?, ?, ?)")
    .run(event, scriptName, oldHash, newHash);
}

export async function notifyAdmin(text: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.admin.notifyWebhook) return;  // 未配置则只落库
  try {
    await fetch(cfg.admin.notifyWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
    });
  } catch (err) {
    traceLogger("watcher").warn({ err }, "admin notify failed (non-fatal)");
  }
}

/** 启动脚本目录监听；返回清理函数。 */
export function watchScripts(dir: string): () => void {
  const log = traceLogger("watcher");
  const hashes = new Map<string, string>();

  const watcher = chokidar.watch(dir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher
    .on("add", (p) => {
      const name = p.split(/[\\/]/).pop()!;
      const h = hashFile(p);
      hashes.set(p, h ?? "");
      auditScriptEvent("add", name, null, h);
      log.info({ script: name }, "script added");
      void notifyAdmin(`[脚本库] 新增脚本 ${name}（已自动审计）`);
    })
    .on("change", (p) => {
      const name = p.split(/[\\/]/).pop()!;
      const old = hashes.get(p) ?? null;
      const h = hashFile(p);
      hashes.set(p, h ?? "");
      auditScriptEvent("modify", name, old, h);
      log.info({ script: name }, "script modified");
      void notifyAdmin(`[脚本库] 脚本变更 ${name}（已自动审计）`);
    })
    .on("unlink", (p) => {
      const name = p.split(/[\\/]/).pop()!;
      auditScriptEvent("remove", name, hashes.get(p) ?? null, null);
      hashes.delete(p);
      log.info({ script: name }, "script removed");
      void notifyAdmin(`[脚本库] 脚本删除 ${name}（已自动审计）`);
    });

  return () => { void watcher.close(); };
}
