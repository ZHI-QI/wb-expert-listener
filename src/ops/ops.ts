/**
 * ops.ts — /health（组件汇总）+ /metrics（Prometheus）+ 连续失败告警。
 */
import type { Express } from "express";
import { allChannels } from "../channels/base.js";
import { kbHealthy } from "../kb/router.js";
import { getConfig } from "../config.js";
import { traceLogger } from "../log/logger.js";
import { incCounter, renderPrometheus, setGauge, counterValue, observeLatency } from "./metrics.js";
import type { SessionPool } from "../core/session-pool.js";
import type { UserQueue } from "../core/queue.js";

export interface OpsContext {
  pool?: SessionPool;
  queue?: UserQueue;
  startedAt: number;
}

/** 连续失败追踪：连续 3 次推管理员。 */
const failStreaks = new Map<string, number>();
export function reportOutcome(scope: string, ok: boolean): void {
  if (ok) {
    failStreaks.delete(scope);
    return;
  }
  incCounter("wb_failures_total{scope=\"" + scope + "\"}");
  const n = (failStreaks.get(scope) ?? 0) + 1;
  failStreaks.set(scope, n);
  if (n === 3) {
    const cfg = getConfig();
    traceLogger("ops").error({ scope, streak: n }, "3 consecutive failures — alerting admin");
    if (cfg.admin.notifyWebhook) {
      void fetch(cfg.admin.notifyWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msg_type: "text", content: { text: `[告警] ${scope} 连续失败 ${n} 次，请检查` } }),
      }).catch(() => {});
    }
  }
}

export function mountOps(app: Express, ctx: OpsContext): void {
  setGauge("wb_uptime_seconds", () => Math.floor((Date.now() - ctx.startedAt) / 1000));

  app.get("/health", async (_req, res) => {
    const channels: Record<string, boolean> = {};
    for (const ch of allChannels()) channels[ch.name] = await ch.healthy().catch(() => false);
    const kb = await kbHealthy().catch(() => ({ mode: "okf" as const, healthy: false }));
    const poolStats = ctx.pool?.stats();
    const queueStats = ctx.queue?.stats();
    const componentsOk = Object.values(channels).some(Boolean) && kb.healthy;

    res.status(componentsOk ? 200 : 503).json({
      status: componentsOk ? "ok" : "degraded",
      uptimeSec: Math.floor((Date.now() - ctx.startedAt) / 1000),
      channels,
      kb,
      pool: poolStats,
      queue: queueStats,
      failures: Object.fromEntries(failStreaks),
    });
  });

  app.get("/metrics", (_req, res) => {
    if (ctx.pool) {
      const s = ctx.pool.stats();
      setGauge("wb_pool_size", () => ctx.pool!.stats().size);
      setGauge("wb_pool_busy", () => ctx.pool!.stats().busy);
      setGauge("wb_pool_coldpath_total", () => ctx.pool!.stats().coldPathCount);
      setGauge("wb_pool_lru_evictions_total", () => ctx.pool!.stats().lruEvictions);
    }
    if (ctx.queue) {
      setGauge("wb_queue_waiting", () => ctx.queue!.stats().waiting);
      setGauge("wb_queue_active", () => ctx.queue!.stats().active);
    }
    setGauge("wb_script_failures_total", () => counterValue('wb_failures_total{scope="script"}'));
    res.type("text/plain; version=0.0.4").send(renderPrometheus());
  });

  // 总结查询（管理用）
  app.get("/admin/summaries", (_req, res) => {
    const { getDb } = require("../db/index.js") as typeof import("../db/index.js");
    const rows = getDb().prepare("SELECT * FROM summaries ORDER BY id DESC LIMIT 100").all();
    res.json(rows);
  });
}

export { incCounter, observeLatency };
