import { describe, it, expect } from "vitest";
import { UserQueue } from "./queue.js";
import { sleep } from "../common.js";

describe("UserQueue", () => {
  it("serializes tasks of the same user in submission order", async () => {
    const q = new UserQueue(10);
    const order: number[] = [];
    const mk = (i: number, ms: number) => async () => {
      await sleep(ms);
      order.push(i);
    };
    // 故意乱序耗时：1 最慢，提交顺序 1,2,3 → 完成顺序必须也是 1,2,3
    await Promise.all([
      q.submit("u1", mk(1, 50)),
      q.submit("u1", mk(2, 10)),
      q.submit("u1", mk(3, 5)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("runs different users in parallel", async () => {
    const q = new UserQueue(10);
    const order: string[] = [];
    const slow = q.submit("a", async () => { await sleep(60); order.push("a"); });
    const fast = q.submit("b", async () => { await sleep(5); order.push("b"); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["b", "a"]);       // b 先完成 = 真并行
  });

  it("respects global concurrency limit", async () => {
    const q = new UserQueue(3);
    let inflight = 0;
    let peak = 0;
    const task = async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await sleep(10);
      inflight--;
    };
    const users = Array.from({ length: 50 }, (_, i) => `u${i}`);
    await Promise.all(users.map((u) => q.submit(u, task)));
    expect(peak).toBeLessThanOrEqual(3);     // 并发50无异常且峰值≤3
    expect(peak).toBeGreaterThan(1);         // 确实并行了
  });

  it("failed task does not break the chain", async () => {
    const q = new UserQueue(5);
    const results: string[] = [];
    await q.submit("u1", async () => { throw new Error("boom"); }).catch(() => results.push("err"));
    await q.submit("u1", async () => results.push("ok"));
    expect(results).toEqual(["err", "ok"]);
  });

  it("propagates task return values", async () => {
    const q = new UserQueue(5);
    const v = await q.submit("u1", async () => 42);
    expect(v).toBe(42);
  });
});
