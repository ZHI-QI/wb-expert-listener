import { getConfig } from "./config.js";
import { migrate } from "./db/index.js";
import { getLogger, newTraceId, traceLogger } from "./log/logger.js";
import { registerChannel, allChannels, type ChannelAdapter } from "./channels/base.js";
import { createCliChannel } from "./channels/cli.js";
import { createDispatcher, type DispatcherDeps } from "./channels/dispatcher.js";
import { createFeishuChannel } from "./channels/feishu.js";
import { createWecomChannel } from "./channels/wecom.js";
import express from "express";
import http from "node:http";

/** 启动所有已启用渠道。deps.handleMessage 由 AgentRunner 提供。 */
export async function main(deps: DispatcherDeps): Promise<() => void> {
  const cfg = getConfig();
  const log = getLogger();
  const dispatch = await createDispatcher(deps);
  const cleanups: Array<() => void> = [];

  // 管理 HTTP 服务（127.0.0.1 only）：渠道回调挂载点 + /health + /metrics（Task 12 扩展）
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(cfg.port, "127.0.0.1", resolve));

  const enabled: ChannelAdapter[] = [createCliChannel()];
  if (cfg.channels.feishu.enabled) enabled.push(createFeishuChannel((a) => void a)); // 挂载复用同一 app
  if (cfg.channels.wecom.enabled) enabled.push(createWecomChannel());

  for (const ch of enabled) {
    registerChannel(ch);
    const stop = await ch.start(async (msg) => {
      const tlog = traceLogger(msg.traceId, { channel: ch.name, userId: msg.userId });
      tlog.info({ msgId: msg.msgId }, "message in");
      await dispatch(ch, msg);
      tlog.info("message handled");
    });
    cleanups.push(stop);
    log.info({ channel: ch.name }, "channel started");
  }

  log.info({ channels: allChannels().map((c) => c.name), port: cfg.port }, "all channels up");
  return () => {
    cleanups.forEach((fn) => { try { fn(); } catch { /* best effort */ } });
    server.close();
  };
}

export { newTraceId };
