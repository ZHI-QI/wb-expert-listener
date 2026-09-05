/**
 * feishu.ts — 飞书机器人渠道：官方长连接模式（WSClient）。
 *
 * 为什么是长连接：无需公网 IP/域名、无需验签解密（SDK 内置）、本机直接收事件。
 * 客户端主动连 wss://open.feishu.cn/event，事件经该通道推送。
 *
 * 注意时序：飞书后台保存「使用长连接接收事件」前，本服务必须已在线。
 * 回复走 IM API（tenant_access_token）。
 */
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";

export function createFeishuChannel(): ChannelAdapter {
  const cfg = getConfig();
  const conf = cfg.channels.feishu;
  let tenantToken: { token: string; exp: number } | null = null;
  let alive = false;

  async function getTenantToken(): Promise<string> {
    if (tenantToken && Date.now() < tenantToken.exp - 60_000) return tenantToken.token;
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: conf.appId, app_secret: conf.appSecret }),
    });
    const data = (await res.json()) as { code: number; tenant_access_token?: string; expire?: number; msg?: string };
    if (data.code !== 0 || !data.tenant_access_token) throw new Error(`feishu token error ${data.code}: ${data.msg}`);
    tenantToken = { token: data.tenant_access_token, exp: Date.now() + (data.expire ?? 7200) * 1000 };
    return tenantToken.token;
  }

  const adapter: ChannelAdapter = {
    name: "feishu",

    async start(onMessage) {
      if (!conf.enabled || !conf.appId || !conf.appSecret) {
        traceLogger("feishu").info("feishu disabled (no appId/secret) — skipped");
        return () => {};
      }

      // 延迟 import：测试环境不加载 SDK
      const Lark = await import("@larksuiteoapi/node-sdk");

      const wsClient = new Lark.WSClient({
        appId: conf.appId,
        appSecret: conf.appSecret,
        loggerLevel: Lark.LoggerLevel.warn,
      });

      const eventDispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data: unknown) => {
          const ev = data as {
            message?: { message_id?: string; chat_type?: string; message_type?: string; content?: string };
            sender?: { sender_id?: { open_id?: string } };
          };
          const msg = ev.message;
          const openId = ev.sender?.sender_id?.open_id;
          if (!msg || !openId || msg.message_type !== "text") return;

          let text = "";
          try {
            text = (JSON.parse(msg.content ?? "{}") as { text?: string }).text ?? "";
          } catch { return; }
          text = text.replace(/@_user_\d+\s*/g, "").trim();
          if (!text || text.startsWith("/")) return;

          const incoming: IncomingMessage = {
            channel: "feishu",
            userId: `feishu:${openId}`,
            text,
            msgId: msg.message_id ?? `feishu-${Date.now()}`,
            traceId: newTraceId(),
          };
          void onMessage(incoming).catch((err) =>
            traceLogger(incoming.traceId).error({ err }, "feishu handle failed"),
          );
        },
      });

      await wsClient.start({ eventDispatcher });
      alive = true;
      traceLogger("feishu").info("feishu long-connection up (WSClient)");

      return () => { alive = false; };
    },

    async reply(orig: IncomingMessage, segment: ReplySegment) {
      if (segment.type === "progress") return; // 不做中间进度推送，避免刷屏
      const token = await getTenantToken();
      const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receive_id: orig.userId.replace("feishu:", ""),
          content: JSON.stringify({ text: segment.text.slice(0, 4000) }),
          msg_type: "text",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        traceLogger(orig.traceId).warn({ status: res.status }, "feishu reply failed");
      }
    },

    async healthy() {
      return conf.enabled && alive;
    },
  };

  return adapter;
}
