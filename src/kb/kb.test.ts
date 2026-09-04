import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { searchOkf, parseConcept, loadBundle } from "./okf.js";
import { currentMode, switchMode, kbSearch, kbHealthy } from "./router.js";
import { getDb, migrate, closeDb } from "../db/index.js";

let dir: string;
let kbDir: string;

const concept = (title: string, tags: string, body: string) => `---
type: FAQ
title: ${title}
description: ${title}相关
tags: [${tags}]
---
${body}
`;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-kb-"));
  process.env.WB_DB_PATH = path.join(dir, "t.db");
  process.env.WB_LOG_DIR = path.join(dir, "logs");
  kbDir = path.join(dir, "kb");
  mkdirSync(path.join(kbDir, "faq"), { recursive: true });
  writeFileSync(path.join(kbDir, "faq", "account.md"), concept("账户问题", "faq, account", "# 账户问题\n\n忘记密码怎么办：点登录页「忘记密码」用手机号重置。"), "utf-8");
  writeFileSync(path.join(kbDir, "faq", "order.md"), concept("订单问题", "faq, order", "# 订单问题\n\n退款流程：订单详情 → 申请退款 → 1-3 个工作日到账。"), "utf-8");
  writeFileSync(path.join(kbDir, "index.md"), "# 目录\n\n* [账户问题](faq/account.md)\n", "utf-8");
  process.env.WB_KB_OKF_DIR = kbDir;
  migrate(getDb());
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WB_DB_PATH;
  delete process.env.WB_LOG_DIR;
  delete process.env.WB_KB_OKF_DIR;
});

describe("okf", () => {
  it("parses concept frontmatter (type/title/tags) and skips index.md", () => {
    const c = parseConcept(path.join(kbDir, "faq", "account.md"), kbDir);
    expect(c).not.toBeNull();
    expect(c!.title).toBe("账户问题");
    expect(c!.tags).toEqual(["faq", "account"]);
    expect(c!.id).toBe("faq/account");
    expect(parseConcept(path.join(kbDir, "index.md"), kbDir)).toBeNull();
  });

  it("search ranks title hits above body hits", () => {
    const hits = searchOkf("密码 重置", kbDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].concept.title).toBe("账户问题");
  });
});

describe("kb router (SC6)", () => {
  it("defaults to okf and searches", async () => {
    expect(currentMode()).toBe("okf");
    const r = await kbSearch("退款");
    expect(r.mode).toBe("okf");
    expect(r.hits[0].title).toBe("订单问题");
  });

  it("hot-switches to ima; ima search errors clearly until configured", async () => {
    switchMode("ima");
    expect(currentMode()).toBe("ima");
    await expect(kbSearch("退款")).rejects.toThrow(/ima|okf/);
    const h = await kbHealthy();
    expect(h.mode).toBe("ima");
    expect(h.healthy).toBe(false);
    switchMode("okf");
    expect(currentMode()).toBe("okf");
  });
});
