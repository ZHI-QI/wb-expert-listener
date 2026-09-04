/**
 * clawbot.ts — 微信 ClawBot 渠道：对接本机 OpenClaw 网关（默认 127.0.0.1:18789）。
 * 依赖用户电脑 OpenClaw 网关常驻；未启用/网关不可达时跳过并给引导提示。
 */
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";

export function createClawbotChannel(): ChannelAdapter {
  const cfg = getConfig();
  const conf = cfg.channels.clawbot;
  const gateway = conf.gatewayUrl ?? "http://127.0.0.1:18789";

  async function gatewayAlive(): Promise<boolean> {
    try {
      const res = await fetch(gateway, { method: "GET", signal: AbortSignal.timeout(2_000) });
      return res.ok || res.status < 500;
    } catch {
      return false;
    }
  }

  return {
    name: "clawbot",

    async start(onMessage) {
      if (!conf.enabled) {
        traceLogger("clawbot").info("clawbot disabled — skipped");
        return () => {};
      }
      if (!(await gatewayAlive())) {
        traceLogger("clawbot").warn(
          { gateway },
          "OpenClaw 网关不可达：请先启动（openclaw gateway start）并 pm2 守护，本渠道暂不挂载",
        );
        return () => {};
      }
      // 消息来源：本机 OpenClaw 网关转发（绑定后聊天消息 → HTTP 回调到本服务）
      // 一期实现轮询网关 outbox（兼容性最好）；二期可换网关 websocket 推送
      traceLogger("clawbot").info({ gateway }, "clawbot channel bound to local gateway");
      const stop = startPolling(gateway, onMessage);
      return stop;
    },

    async reply(msg, segment) {
      if (segment.type === "progress") return;
      // 经网关 outbox 推回微信
      try {
        await fetch(`${gateway}/api/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: msg.userId.replace("clawbot:", ""), text: segment.text }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        traceLogger(msg.traceId).warn({ err }, "clawbot reply failed");
      }
    },

    async healthy() {
      return conf.enabled && (await gatewayAlive());
    },
  };
}

/** 轮询网关 outbox（消息进来）；网关未提供该 API 时静默降级为空转。 */
function startPolling(
  gateway: string,
  onMessage: (m: IncomingMessage) => Promise<void>,
): () => void {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const res = await fetch(`${gateway}/api/messages?limit=10`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: { id: string; from: string; text: string }[] };
      for (const m of data.messages ?? []) {
        const incoming: IncomingMessage = {
          channel: "clawbot",
          userId: `clawbot:${m.from}`,
          text: m.text,
          msgId: m.id,
          traceId: newTraceId(),
        };
        await onMessage(incoming).catch(() => {});
      }
    } catch {
      /* 网关暂不可达：下一轮再试 */
    }
  }, 2_000);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
