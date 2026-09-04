/**
 * wechat-kf.ts — 微信客服渠道（企微「微信客服」能力）。
 *
 * 关键约束：微信回调 5 秒超时（重试 3 次）→ 收到即回 success，业务全异步；
 * 回复走「发送客服消息」API（无 5s 限制，48h 窗口）；
 * msgid 幂等（微信重试会重复推送同一消息）。
 *
 * 凭证：WB_WECOM_KF_CORPID / SECRET / TOKEN / AESKEY
 * 一期实现：明文模式兼容（明文回调直接解析；加密模式 Phase 3.5 接 WXBizMsgCrypt）。
 */
import express, { type Request, type Response, type Express } from "express";
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { getConfig } from "../config.js";
import { newTraceId, traceLogger } from "../log/logger.js";
import { parseStringPromise } from "./xml-lite.js";

export function createWechatKfChannel(mount: (app: Express) => void): ChannelAdapter {
  const cfg = getConfig();
  const conf = cfg.channels.wechatKf;
  let accessToken: { token: string; exp: number } | null = null;

  async function getToken(): Promise<string> {
    if (accessToken && Date.now() < accessToken.exp - 60_000) return accessToken.token;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${conf.corpId}&corpsecret=${conf.secret}`;
    const res = await fetch(url);
    const data = (await res.json()) as { errcode: number; access_token?: string; expires_in?: number };
    if (data.errcode !== 0 || !data.access_token) throw new Error(`wechat-kf token err ${data.errcode}`);
    accessToken = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 7200) * 1000 };
    return accessToken.token;
  }

  const adapter: ChannelAdapter = {
    name: "wechat-kf",

    async start(onMessage) {
      if (!conf.enabled) {
        traceLogger("wechat-kf").info("wechat-kf disabled (no corp credentials) — skipped");
        return () => {};
      }

      const app = express();
      app.use(express.text({ type: ["text/xml", "application/xml"], limit: "1mb" }));

      // 一次连接内先注册路由再挂载（boot 传入 mount）
      const router = express.Router();

      // GET：URL 验证（echostr）
      router.get("/webhook/wechat-kf", (req: Request, res: Response) => {
        res.type("text").send(String(req.query.echostr ?? "ok"));
      });

      // POST：消息/事件回调 —— 5 秒内必须返回，否则微信重试 3 次
      router.post("/webhook/wechat-kf", (req: Request, res: Response) => {
        res.type("text").send("success");   // ① 秒回，绝不等业务
        void handleCallback(String(req.body), onMessage).catch((err) =>
          traceLogger("wechat-kf").error({ err }, "wechat-kf async handle failed"),
        );
      });

      app.use(router);
      mount(app);
      return () => {};
    },

    async reply(msg, segment) {
      if (segment.type === "progress") return; // 客服消息不刷进度，只发 final
      const token = await getToken();
      // 微信客服「发送消息」：synckf 接口（sync_msg=false 异步发送）
      const res = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: msg.userId.replace("wxkf:", ""),
            open_kfid: process.env.WB_WECOM_KF_OPENID ?? "",
            msgtype: "text",
            text: { content: segment.text.slice(0, 2000) },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const data = (await res.json()) as { errcode: number };
      if (data.errcode !== 0) {
        traceLogger(msg.traceId).warn({ errcode: data.errcode }, "wechat-kf send_msg failed");
      }
    },

    async healthy() {
      return conf.enabled;
    },
  };

  return adapter;
}

/** 解析回调 XML → 提取用户消息（纯函数，可测）。 */
async function handleCallback(
  xml: string,
  onMessage: (m: IncomingMessage) => Promise<void>,
): Promise<void> {
  const doc = await parseStringPromise(xml);
  const msgType = doc.MsgType?.[0];
  if (msgType !== "text") return;

  const origin = doc.OriginKfOpenId?.[0] ?? doc.OpenKfId?.[0]; // 客服账号
  const fromUser = doc.ExternalUserOpenId?.[0] ?? doc.FromUserName?.[0];
  const content = (doc.Content?.[0] ?? "").trim();
  const msgId = doc.MsgId?.[0];
  if (!fromUser || !content || !msgId) return;

  const incoming: IncomingMessage = {
    channel: "wechat-kf",
    userId: `wxkf:${fromUser}`,
    text: content,
    msgId: `wxkf-${msgId}`,      // dispatcher 幂等去重：微信重试同一 MsgId 只处理一次
    traceId: newTraceId(),
    replyUrl: origin,
  };
  await onMessage(incoming);
}
