/**
 * wecom.ts — 企微智能机器人渠道：长连接模式（免域名，官方文档 path/101463）。
 *
 * 协议：WSS + JSON 帧订阅（aibot_subscribe）与回调（aibot_msg_callback）；
 * 回复用回调帧透传的 response_url（仅一次有效，1 小时时限）。
 *
 * Node ≥22 全局 WebSocket（undici）— 零额外依赖。
 * 状态机：connecting → subscribed（心跳保活）；断线指数退避重连。
 */
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";
import { randomUUID } from "node:crypto";

const WSS_URL = "wss://cbt.work.weixin.qq.com/wecom_bot/ws"; // 官方长连接接入点

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

  return {
    channel: "wecom",
    userId: `wecom:${b.from.userid}`,
    text,
    msgId: b.msgid ?? `wecom-${Date.now()}`,
    traceId: newTraceId(),
    replyUrl: b.response_url,
  };
}

export async function replyViaResponseUrl(url: string, segment: ReplySegment): Promise<boolean> {
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
  let ws: WebSocket | null = null;
  let stopped = true;
  let heartbeat: NodeJS.Timeout | null = null;
  let retries = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let alive = false;

  function clearTimers(): void {
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeat = null;
    reconnectTimer = null;
  }

  function scheduleReconnect(onMessage: (m: IncomingMessage) => Promise<void>): void {
    if (stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** retries); // 1s,2s,4s…上限30s
    retries++;
    traceLogger("wecom").warn({ delay, retry: retries }, "wecom ws reconnect scheduled");
    reconnectTimer = setTimeout(() => void connect(onMessage), delay);
  }

  async function connect(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
    if (stopped) return;
    const log = traceLogger("wecom");
    alive = false;
    try {
      ws = new WebSocket(WSS_URL);
    } catch (err) {
      log.error({ err }, "wecom ws construct failed");
      scheduleReconnect(onMessage);
      return;
    }

    ws.onopen = () => {
      ws?.send(JSON.stringify({
        cmd: "aibot_subscribe",
        headers: { req_id: randomUUID() },
        body: { bot_id: cfg.channels.wecom.botId, secret: cfg.channels.wecom.secret },
      }));
    };

    ws.onmessage = (ev: MessageEvent) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const cmd = frame.cmd as string;

      if (cmd === "aibot_subscribe" && (frame.errcode as number) === 0) {
        retries = 0;
        alive = true;
        log.info("wecom subscribed (long-connection up)");
        heartbeat = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ cmd: "heartbeat", headers: { req_id: randomUUID() }, body: {} }));
          }
        }, 30_000);
        heartbeat.unref?.();
        return;
      }
      if (cmd === "aibot_msg_callback") {
        const msg = parseWecomCallback(frame);
        if (msg) void onMessage(msg).catch(() => {});
      }
    };

    ws.onclose = () => {
      clearTimers();
      alive = false;
      if (!stopped) scheduleReconnect(onMessage);
    };
    ws.onerror = () => { /* onclose 跟进重连 */ };
  }

  return {
    name: "wecom",

    async start(onMessage) {
      if (!cfg.channels.wecom.enabled) {
        traceLogger("wecom").info("wecom channel disabled (no bot_id/secret) — skipped");
        return () => {};
      }
      stopped = false;
      await connect(onMessage);
      return () => {
        stopped = true;
        clearTimers();
        ws?.close();
      };
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
      return cfg.channels.wecom.enabled && alive;
    },
  };
}
