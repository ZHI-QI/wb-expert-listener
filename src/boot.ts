import { getConfig } from "./config.js";
import { migrate } from "./db/index.js";
import { getLogger, newTraceId, traceLogger } from "./log/logger.js";
import { registerChannel, allChannels, type ChannelAdapter } from "./channels/base.js";
import { createCliChannel } from "./channels/cli.js";
import { createDispatcher, type DispatcherDeps } from "./channels/dispatcher.js";

/** 启动所有已启用渠道。deps.handleMessage 由 Task 3 的 AgentRunner 提供。 */
export async function main(deps: DispatcherDeps): Promise<() => void> {
  const cfg = getConfig();
  const log = getLogger();
  const dispatch = await createDispatcher(deps);
  const cleanups: Array<() => void> = [];

  const enabled: ChannelAdapter[] = [];
  if (cfg.channels.cli.enabled) enabled.push(createCliChannel());
  // feishu / wecom / clawbot / wechat-kf 在 Task 8/10 接入

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

  log.info({ channels: allChannels().map((c) => c.name) }, "all channels up");
  return () => cleanups.forEach((fn) => { try { fn(); } catch { /* best effort */ } });
}

export { newTraceId };
