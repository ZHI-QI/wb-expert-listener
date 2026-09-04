import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, resetConfigCache } from "./config.js";

describe("loadConfig", () => {
  beforeEach(() => resetConfigCache());

  it("loads defaults without any env (CLI + okf)", () => {
    const cfg = loadConfig();
    expect(cfg.port).toBe(18790);
    expect(cfg.channels.cli.enabled).toBe(true);
    expect(cfg.kb.mode).toBe("okf");
  });

  it("reads kb.mode from env", () => {
    process.env.WB_KB_MODE = "ima";
    try {
      expect(loadConfig().kb.mode).toBe("ima");
    } finally {
      delete process.env.WB_KB_MODE;
    }
  });

  it("rejects pool.max < pool.core", () => {
    expect(() =>
      loadConfig({ pool: { core: 20, max: 8, keepAliveMs: 1 } }),
    ).toThrowError(/pool\.max/);
  });

  it("rejects invalid kb.mode", () => {
    expect(() => loadConfig({ kb: { mode: "bad" as "okf", okfDir: "x" } })).toThrowError(/kb\.mode/);
  });
});
