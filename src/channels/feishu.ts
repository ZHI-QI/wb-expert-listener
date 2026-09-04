/**
 * feishu.ts — 飞书机器人渠道：事件回调模式。
 * 未配置凭证时不启动（healthy=false）；凭证配置走 .env：
 *   WB_FEISHU_APP_ID / WB_FEISHU_APP_SECRET / WB_FEISHU_VERIFY_TOKEN(可选) / WB_FEISHU_ENCRYPT_KEY(可选)
 */
import express, { type Request, type Response } from "express";
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";

export function createFeishuChannel(mount: (app: express.Express) => void): ChannelAdapter {
  const cfg = getConfig();
  const conf = cfg.channels.feishu;
  let tenantToken: { token: string; exp: number } | null = null;

  async function getTenantToken(): Promise<string> {
    if (tenantToken && Date.now() < tenantToken.exp - 60_000) return tenantToken.token;
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: conf.appId, app_secret: conf.appSecret }),
    });
    const data = (await res.json()) as { code: number; tenant_access_token: string; expire: number };
    if (data.code !== 0) throw new Error(`feishu token error ${data.code}`);
    tenantToken = { token: data.tenant_access_token, exp: Date.now() + data.expire * 1000 };
    return tenantToken.token;
  }

  const adapter: ChannelAdapter = {
    name: "feishu",

    async start(onMessage) {
      if (!conf.enabled) {
        traceLogger("feishu").info("feishu channel disabled (no credentials) — skipped");
        return () => {};
      }
      const app = express();
      app.use(express.json());

      app.post("/webhook/feishu", async (req: Request, res: Response) => {
        const body = req.body as Record<string, unknown>;

        // URL 验证（飞书配置回调时的 challenge）
        if (body.type === "url_verification") {
          res.json({ challenge: body.challenge });
          return;
        }

        res.json({ code: 0 }); // 秒回，业务异步

        const event = body.event as { message?: { message_id: string; chat_type: string; content: string; message_type: string } } | undefined;
        const msg = event?.message;
        const senderId = (body.event as { sender?: { sender_id?: { open_id?: string } } } | undefined)?.sender?.sender_id?.open_id;
        if (!msg || msg.message_type !== "text" || !senderId) return;

        let text = "";
        try {
          text = (JSON.parse(msg.content) as { text?: string }).text ?? "";
        } catch { return; }
        if (!text.trim() || text.startsWith("/")) return; // 命令消息不进管线

        const incoming: IncomingMessage = {
          channel: "feishu",
          userId: `feishu:${senderId}`,
          text: text.replace(/@_user_\d+\s*/g, "").trim(),
          msgId: msg.message_id,
          traceId: newTraceId(),
        };
        void onMessage(incoming).catch((err) =>
          traceLogger(incoming.traceId).error({ err }, "feishu handle failed"),
        );
      });

      mount(app);
      return () => { /* server 生命周期由 boot 统一管理 */ };
    },

    async reply(orig: IncomingMessage, segment: ReplySegment) {
      if (!orig.msgId) return;
      if (segment.type === "progress") return; // 飞书消息 API 不做中间进度推送（避免刷屏）
      const token = await getTenantToken();
      const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receive_id: orig.userId.replace("feishu:", ""),
          content: JSON.stringify({ text: segment.text }),
          msg_type: "text",
          reply_in_thread: false,
        }),
      });
      if (!res.ok) {
        traceLogger(orig.traceId).warn({ status: res.status }, "feishu reply failed");
      }
    },

    async healthy() {
      return conf.enabled;
    },
  };

  return adapter;
}
