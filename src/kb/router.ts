/**
 * router.ts — 知识库路由：kb.mode 单选（okf | ima），热切换（kv 表持久化）。
 * 一次只激活一个模式（spec 明确：每次只能切换一个）。
 */
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { searchOkf } from "./okf.js";
import { createImaClient } from "./ima.js";

export type KbMode = "okf" | "ima";
const KV_KEY = "kb.mode";

export function currentMode(): KbMode {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(KV_KEY) as { value: string } | undefined;
  return (row?.value as KbMode) ?? getConfig().kb.mode;
}

/** 切换模式：立即生效（SC6）。 */
export function switchMode(mode: KbMode): KbMode {
  getDb().prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(KV_KEY, mode);
  return mode;
}

export interface KbAnswer {
  mode: KbMode;
  hits: { title: string; snippet: string; source: string }[];
}

/** 统一检索入口：只走当前模式。 */
export async function kbSearch(query: string, topN = 3): Promise<KbAnswer> {
  const mode = currentMode();
  if (mode === "okf") {
    const cfg = getConfig();
    return {
      mode,
      hits: searchOkf(query, cfg.kb.okfDir, topN).map((h) => ({
        title: h.concept.title,
        snippet: h.snippet,
        source: h.concept.id,
      })),
    };
  }
  const ima = createImaClient();
  const hits = await ima.search(query, topN);
  return { mode, hits: hits.map((h) => ({ title: h.title, snippet: h.snippet, source: h.url ?? "ima" })) };
}

/** 健康探测（/health 用）。 */
export async function kbHealthy(): Promise<{ mode: KbMode; healthy: boolean; degraded?: string }> {
  const mode = currentMode();
  if (mode === "okf") return { mode, healthy: true };
  const ok = await createImaClient().healthy();
  return { mode, healthy: ok, degraded: ok ? undefined : "ima endpoint 不可达或未配置" };
}
