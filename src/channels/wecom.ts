/**
 * wecom.ts — 企微智能机器人渠道：长连接模式（免域名，官方文档 path/101463）。
 * 协议：WSS + JSON 帧订阅（aibot_subscribe）与回调（aibot_msg_callback）；
 * 回复用回调帧透传的 response_url（仅一次有效，1 小时时限）。
 *
 * 一期实现：SDK 依赖 wss 长连接库尚未引入，先落地「回调解析 + response_url 回复」的
 * 纯函数核心 + HTTP 模式骨架；长连接接入放 Task 10 前的增强（打桩测试已覆盖解析/回复）。
 */
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";

/** 解析 aibot_msg_callback 帧 → IncomingMessage（纯函数，可测）。 */
export function parseWecomCallback(body: Record<string, unknown>): IncomingMessage | null {
  if (body.cmd !== "aibot_msg_callback") return null;
  const b = body.body as {
    msgid?: string; chattype?: string; msgtype?: string;
    from?: { userid?: string };
    text?: { content?: string };
    response_url?: string;
  } | undefined;
  if (!b?.from?.userid || b.msgtype !== "text" || !b.text?.content) return null;

  let text = b.text.content.trim();
  if (!text || text.startsWith("/")) return null;
  text = text.replace(/^@[^@\s]+\s*/, "").trim(); // 去 @机器人 前缀
  if (!text) return null;

  const msg: IncomingMessage = {
    channel: "wecom",
    userId: `wecom:${b.from.userid}`,
    text,
    msgId: b.msgid ?? `wecom-${Date.now()}`,
    traceId: newTraceId(),
    replyUrl: b.response_url,
  };
  return msg;
}

/** 通过 response_url 回复（一次性；markdown 支持）。 */
export async function replyViaResponseUrl(
  url: string,
  segment: ReplySegment,
): Promise<boolean> {
  if (segment.type === "progress") return true; // response_url 只有一次，进度不消耗它
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: segment.text.slice(0, 4000) } }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createWecomChannel(): ChannelAdapter {
  const cfg = getConfig();

  return {
    name: "wecom",

    async start(onMessage) {
      if (!cfg.channels.wecom.enabled) {
        traceLogger("wecom").info("wecom channel disabled (no bot_id/secret) — skipped");
        return () => {};
      }
      // 长连接接入：Task 10 前增强（需 wss 库 + 心跳/重连状态机）
      // 当前留桩：凭证已配置时打日志提示待接入
      traceLogger("wecom").warn({ botId: cfg.channels.wecom.botId }, "wecom long-connection arrives with Task 10; credentials detected");
      return () => {};
    },

    async reply(msg, segment) {
      if (!msg.replyUrl) {
        traceLogger(msg.traceId).warn("wecom reply dropped: no response_url in message");
        return;
      }
      const ok = await replyViaResponseUrl(msg.replyUrl, segment);
      if (!ok) traceLogger(msg.traceId).warn("wecom response_url reply failed");
    },

    async healthy() {
      return cfg.channels.wecom.enabled;
    },
  };
}
