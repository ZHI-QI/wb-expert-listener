/**
 * ChannelAdapter — 所有渠道适配器的统一接口。
 * 新增渠道 = 新增一个实现文件并在 registry 注册，零侵入核心。
 */

export interface IncomingMessage {
  channel: string;          // 渠道标识：cli / feishu / wecom / clawbot / wechat-kf
  userId: string;           // 渠道内稳定用户标识（渠道前缀建议：wecom:zhangsan）
  userName?: string;
  text: string;             // 用户消息文本
  msgId: string;            // 渠道消息ID，用于幂等去重
  replyUrl?: string;        // 渠道回复句柄（response_url 等，一次性）
  traceId: string;
}

export type ReplySegment =
  | { type: "text"; text: string }        // 普通文本段
  | { type: "progress"; text: string }    // 中间进度（可忽略或以轻提示展示）
  | { type: "final"; text: string };      // 最终完整回答

export interface ChannelAdapter {
  readonly name: string;
  /** 启动监听；返回清理函数。 */
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<() => void>;
  /** 向用户推送回复段。 */
  reply(msg: IncomingMessage, segment: ReplySegment): Promise<void>;
  /** 健康自检：true = 正常。 */
  healthy(): Promise<boolean>;
}

const registry = new Map<string, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  if (registry.has(adapter.name)) throw new Error(`channel duplicated: ${adapter.name}`);
  registry.set(adapter.name, adapter);
}

export function getChannel(name: string): ChannelAdapter | undefined {
  return registry.get(name);
}

export function allChannels(): ChannelAdapter[] {
  return [...registry.values()];
}
