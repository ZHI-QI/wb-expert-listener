import { describe, it, expect, vi } from "vitest";
import { SessionPool, type PooledSession, type PoolDeps } from "./session-pool.js";

function mkSession(userId: string): PooledSession {
  return {
    userId,
    state: "idle",
    lastUsed: 0,
    async send(this: PooledSession, _text: string) { return "ack"; },
    async close() { /* noop */ },
  };
}

function mkDeps(overrides: Partial<PoolDeps> = {}): PoolDeps {
  return {
    resumeToPool: vi.fn(async (userId: string) => mkSession(userId)),
    coldQuery: vi.fn(async (userId: string, text: string) => `cold:${userId}:${text}`),
    now: () => 1_000,
    ...overrides,
  };
}

describe("SessionPool", () => {
  it("hot path: idle session reused without rebuild", async () => {
    const deps = mkDeps();
    const pool = new SessionPool(deps, 2, 4);
    const a1 = await pool.acquire("u1");
    expect(a1.kind).toBe("warm");
    a1.release();
    const a2 = await pool.acquire("u1");
    expect(a2.kind).toBe("hot");               // 热命中
    expect(deps.resumeToPool).toHaveBeenCalledTimes(1);
  });

  it("warm session enters pool as busy", async () => {
    const deps = mkDeps();
    const pool = new SessionPool(deps, 2, 4);
    await pool.acquire("u1");                  // 未 release
    expect(pool.stats().busy).toBe(1);         // 不再误报 idle
  });

  it("cold path when pool full and all busy (SC4)", async () => {
    const deps = mkDeps();
    const pool = new SessionPool(deps, 1, 2);
    const a = await pool.acquire("u1");        // warm busy，占1
    const b = await pool.acquire("u2");        // warm busy，占2（满）
    const c = await pool.acquire("u3");        // 全忙 → 冷路径
    expect(c.kind).toBe("cold");
    const out = await c.run("问3");
    expect(out).toBe("cold:u3:问3");
    expect(pool.stats().coldPathCount).toBe(1);
    a.release(); b.release();
  });

  it("LRU eviction when pool full but an idle session exists", async () => {
    const deps = mkDeps();
    const evicted: string[] = [];
    deps.resumeToPool = vi.fn(async (userId: string) => {
      const s = mkSession(userId);
      const origClose = s.close.bind(s);
      s.close = async () => { evicted.push(userId); await origClose(); };
      return s;
    });
    const pool = new SessionPool(deps, 1, 2);
    const a = await pool.acquire("u1"); a.release();   // u1 空闲
    await pool.acquire("u2");                           // u2 busy（满）
    const c = await pool.acquire("u3");                 // 淘汰空闲 u1 → u3 warm
    expect(c.kind).toBe("warm");
    expect(evicted).toContain("u1");
    expect(pool.stats().lruEvictions).toBe(1);
  });

  it("sweeper closes idle sessions beyond core after keepAlive", async () => {
    let clock = 0;
    const deps = mkDeps({ now: () => clock });
    const pool = new SessionPool(deps, 1, 4, 100);
    const a = await pool.acquire("u1"); a.release();
    await pool.acquire("u2").then((h) => h.release());
    clock += 200;                                       // 全部空闲超时
    pool.sweep();
    expect(pool.stats().size).toBeLessThanOrEqual(1);   // core=1
  });

  it("same-user re-acquire while busy goes warm-again (queue layer serializes)", async () => {
    const deps = mkDeps();
    const pool = new SessionPool(deps, 2, 4);
    const first = await pool.acquire("u1");
    const second = await pool.acquire("u1");            // busy 中重复 acquire
    expect(["warm", "cold"]).toContain(second.kind);    // 不会返回 hot
    first.release(); second.release();
  });
});
