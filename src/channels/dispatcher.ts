import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";

/**
 * 消息分发核心：渠道消息 → 处理管线（Task 3 接 Agent，当前回显）→ 回复路由 → 落日志。
 * 渠道适配器只管收发；所有业务在这里。
 */
export interface DispatcherDeps {
  /** 处理用户消息，返回最终回复文本；进度通过 onProgress 回调流出。 */
  handleMessage(
    msg: IncomingMessage,
    onProgress: (text: string) => Promise<void>,
  ): Promise<{ text: string; sessionId?: string }>;
}

export async function createDispatcher(deps: DispatcherDeps) {
  const seen = new Map<string, number>(); // msgId → ts（去重）
  const DEDUP_TTL = 5 * 60_000;

  function isDuplicate(msgId: string): boolean {
    const now = Date.now();
    for (const [k, ts] of seen) if (now - ts > DEDUP_TTL) seen.delete(k);
    if (seen.has(msgId)) return true;
    seen.set(msgId, now);
    return false;
  }

  return async function dispatch(channel: ChannelAdapter, msg: IncomingMessage): Promise<void> {
    if (isDuplicate(msg.msgId)) return; // 幂等：微信重试/渠道重推直接吞掉

    const { appendChatLog } = await import("../log/store.js");
    appendChatLog({ userId: msg.userId, channel: msg.channel, role: "user", content: msg.text, traceId: msg.traceId });

    const onProgress = async (text: string) => {
      await channel.reply(msg, { type: "progress", text });
    };

    try {
      const result = await deps.handleMessage(msg, onProgress);
      appendChatLog({
        userId: msg.userId, channel: msg.channel, sessionId: result.sessionId,
        role: "assistant", content: result.text, traceId: msg.traceId,
      });
      await channel.reply(msg, { type: "final", text: result.text });
    } catch (err) {
      const text = `抱歉，处理消息时出错了：${err instanceof Error ? err.message : String(err)}`;
      appendChatLog({
        userId: msg.userId, channel: msg.channel,
        role: "system", content: `error: ${text}`, traceId: msg.traceId,
      });
      await channel.reply(msg, { type: "final", text });
    }
  };
}
