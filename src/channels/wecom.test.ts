import { describe, it, expect } from "vitest";
import { parseWecomCallback, replyViaResponseUrl } from "./wecom.js";

describe("parseWecomCallback", () => {
  const frame = (over: Record<string, unknown> = {}) => ({
    cmd: "aibot_msg_callback",
    headers: { req_id: "R1" },
    body: {
      msgid: "MSG1",
      chattype: "single",
      msgtype: "text",
      from: { userid: "zhangsan" },
      text: { content: "@RobotA 帮我查订单" },
      response_url: "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=XXX",
      ...over,
    },
  });

  it("parses text message, strips @mention, prefixes user id", () => {
    const msg = parseWecomCallback(frame());
    expect(msg).not.toBeNull();
    expect(msg!.userId).toBe("wecom:zhangsan");
    expect(msg!.text).toBe("帮我查订单");
    expect(msg!.msgId).toBe("MSG1");
    expect(msg!.replyUrl).toContain("response_code=XXX");
  });

  it("rejects non-text or slash-command or empty mentions", () => {
    expect(parseWecomCallback(frame({ msgtype: "image" }))).toBeNull();
    expect(parseWecomCallback(frame({ text: { content: "/cmd" } }))).toBeNull();
    expect(parseWecomCallback(frame({ text: { content: "@RobotA " } }))).toBeNull();
    expect(parseWecomCallback({ cmd: "other" })).toBeNull();
  });
});

describe("replyViaResponseUrl", () => {
  it("consumes response_url only for final segments (progress skipped)", async () => {
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { called++; return new Response(null, { status: 200 }); }) as typeof fetch;
    try {
      expect(await replyViaResponseUrl("https://x/y", { type: "progress", text: "处理中" })).toBe(true);
      expect(called).toBe(0);  // 进度不消耗一次性 URL
      expect(await replyViaResponseUrl("https://x/y", { type: "final", text: "答案" })).toBe(true);
      expect(called).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
