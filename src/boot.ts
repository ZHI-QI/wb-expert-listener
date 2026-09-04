import { getConfig } from "./config.js";
import { migrate } from "./db/index.js";
import { getLogger, newTraceId, traceLogger } from "./log/logger.js";
import { registerChannel, allChannels, type ChannelAdapter } from "./channels/base.js";
import { createCliChannel } from "./channels/cli.js";
import { createDispatcher, type DispatcherDeps } from "./channels/dispatcher.js";
import { createFeishuChannel } from "./channels/feishu.js";
import { createWecomChannel } from "./channels/wecom.js";
import { createClawbotChannel } from "./channels/clawbot.js";
import { createWechatKfChannel } from "./channels/wechat-kf.js";
import { mountOps, type OpsContext } from "./ops/ops.js";
import { startIdleSummarizer, shouldSummarizeByTurns, summarizeUser, type SummaryDeps } from "./summary/summary.js";
import { getDb } from "./db/index.js";
import express from "express";
import http from "node:http";

/** 启动所有已启用渠道。deps.handleMessage 由 AgentRunner 提供；summarize/ops 可选注入。 */
export async function main(deps: DispatcherDeps & { ops?: Partial<OpsContext>; summarize?: SummaryDeps }): Promise<() => void> {
  const cfg = getConfig();
  const log = getLogger();
  const dispatch = await createDispatcher(deps);
  const cleanups: Array<() => void> = [];
  const fallbackSummarizer: SummaryDeps = { summarize: async () => ({ category: "未分类", summary: "（总结器未配置）", resolved: false }) };

  // 管理 HTTP 服务（127.0.0.1 only）：渠道回调挂载点 + /health + /metrics + OKF 上传
  const app = express();
  app.use(express.json({ limit: "20mb" }));  // OKF 上传走 base64 JSON
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(cfg.port, "127.0.0.1", resolve));

  // 运维面（SC12）
  mountOps(app, { startedAt: Date.now(), ...deps.ops });

  // OKF 上传页 + API（仅本地）
  const { mountWeb } = await import("./web/okf-upload.js");
  mountWeb(app);

  const enabled: ChannelAdapter[] = [createCliChannel()];
  if (cfg.channels.feishu.enabled) enabled.push(createFeishuChannel((a) => void a));
  if (cfg.channels.wecom.enabled) enabled.push(createWecomChannel());
  if (cfg.channels.clawbot.enabled) enabled.push(createClawbotChannel());
  if (cfg.channels.wechatKf.enabled) enabled.push(createWechatKfChannel((a) => void a));

  for (const ch of enabled) {
    registerChannel(ch);
    const stop = await ch.start(async (msg) => {
      const tlog = traceLogger(msg.traceId, { channel: ch.name, userId: msg.userId });
      tlog.info({ msgId: msg.msgId }, "message in");
      await dispatch(ch, msg);
      // 每10轮自动总结（SC11）
      if (shouldSummarizeByTurns(msg.userId)) {
        const sid = (getDb().prepare("SELECT session_id FROM user_sessions WHERE user_id = ?").get(msg.userId) as { session_id?: string } | undefined)?.session_id ?? "adhoc";
        void summarizeUser(msg.userId, sid, deps.summarize ?? fallbackSummarizer).catch(() => {});
      }
      tlog.info("message handled");
    });
    cleanups.push(stop);
    log.info({ channel: ch.name }, "channel started");
  }

  // 空闲 30min 自动总结（SC11）
  cleanups.push(startIdleSummarizer(
    (uid) => (getDb().prepare("SELECT session_id FROM user_sessions WHERE user_id = ?").get(uid) as { session_id?: string } | undefined)?.session_id ?? null,
    deps.summarize ?? fallbackSummarizer,
  ));

  log.info({ channels: allChannels().map((c) => c.name), port: cfg.port }, "all channels up");
  return () => {
    cleanups.forEach((fn) => { try { fn(); } catch { /* best effort */ } });
    server.close();
  };
}

export { newTraceId };
