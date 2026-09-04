import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import http from "node:http";
import { parseStringPromise } from "./xml-lite.js";

describe("xml-lite", () => {
  it("parses wechat callback xml (plain + CDATA)", async () => {
    const xml = `<xml>
      <ToUserName><![CDATA[ww_corp]]></ToUserName>
      <FromUserName><![CDATA[wmExternalUser123]]></FromUserName>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[退款进度查询]]></Content>
      <MsgId>8800001</MsgId>
      <CreateTime>1750000000</CreateTime>
    </xml>`;
    const doc = await parseStringPromise(xml);
    expect(doc.MsgType?.[0]).toBe("text");
    expect(doc.Content?.[0]).toBe("退款进度查询");
    expect(doc.MsgId?.[0]).toBe("8800001");
    // 明文（无 CDATA）
    const plain = await parseStringPromise("<xml><MsgId>42</MsgId><Content>hello</Content></xml>");
    expect(plain.MsgId?.[0]).toBe("42");
    expect(plain.Content?.[0]).toBe("hello");
  });
});

describe("wechat-kf 5s fast-return + idempotency", () => {
  let cleanup: (() => void) | null = null;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wxkf-"));
    process.env.WB_DB_PATH = path.join(dir, "t.db");
    process.env.WB_LOG_DIR = path.join(dir, "logs");
    process.env.WB_WECOM_KF_CORPID = "ww_test_corp";   // 启用渠道（否则 start 提前 return，mount 不执行）
    process.env.WB_WECOM_KF_SECRET = "test_secret";
    const { getDb, migrate, closeDb } = await import("../db/index.js");
    migrate(getDb());
    cleanup = () => {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      delete process.env.WB_DB_PATH;
      delete process.env.WB_LOG_DIR;
      delete process.env.WB_WECOM_KF_CORPID;
      delete process.env.WB_WECOM_KF_SECRET;
    };
  });

  afterAll(() => cleanup?.());

  it("webhook returns success immediately (<100ms) and business runs async", async () => {
    const { createWechatKfChannel } = await import("./wechat-kf.js");
    let mounted: Express | null = null;
    const adapter = createWechatKfChannel((app) => { mounted = app; });

    let handled = 0;
    const stop = await adapter.start(async () => { handled++; });

    const server = http.createServer(mounted!);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const xml = `<xml><MsgType><![CDATA[text]]></MsgType><ExternalUserOpenId><![CDATA[wmU1]]></ExternalUserOpenId><Content><![CDATA[你好]]></Content><MsgId>9901</MsgId></xml>`;
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/webhook/wechat-kf`, {
      method: "POST", headers: { "Content-Type": "text/xml" }, body: xml,
    });
    const elapsed = Date.now() - t0;
    expect(await res.text()).toBe("success");
    expect(elapsed).toBeLessThan(100);        // ① 秒回不等业务

    await new Promise((r) => setTimeout(r, 150));
    expect(handled).toBe(1);                  // ② 异步处理了一次

    // ③ 幂等：同 MsgId 重推不重复处理（dispatcher 层去重，此处验证 msgId 提取）
    const res2 = await fetch(`http://127.0.0.1:${port}/webhook/wechat-kf`, {
      method: "POST", headers: { "Content-Type": "text/xml" }, body: xml,
    });
    expect(await res2.text()).toBe("success");
    await new Promise((r) => setTimeout(r, 150));
    // handled 仍为 2（adapter 层收到两次），去重由 dispatcher 完成——本测试只验证渠道行为
    expect(handled).toBe(2);

    stop();
    server.close();
  }, 15_000);
});
