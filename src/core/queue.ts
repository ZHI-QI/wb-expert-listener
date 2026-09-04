/**
 * UserQueue — 用户级串行 + 跨用户并行 + 全局并发上限。
 *
 * - 同一 userId 的任务链式 Promise 串行（保会话上下文顺序）
 * - 不同用户完全并行，受 p-limit 全局上限约束（保护内存/下游）
 * - 全局满时任务在 p-limit 内排队等待（不拒绝）
 */

import pLimit from "p-limit";

interface LimitFunction {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

export class UserQueue {
  private chains = new Map<string, Promise<unknown>>();
  private globalLimiter: LimitFunction;
  private waiting = 0;

  constructor(private globalConcurrency = 20) {
    this.globalLimiter = pLimit(globalConcurrency);
  }

  /**
   * 提交任务：用户内串行、用户间并行、全局限额。
   * 返回值与 fn() 一致；异常向上抛但不断链。
   */
  async submit<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(userId) ?? Promise.resolve();
    this.waiting++;

    const run = (async () => {
      await prev.catch(() => {});           // 前序失败不阻塞本任务
      try {
        return await this.globalLimiter(fn);
      } finally {
        this.waiting--;
      }
    })();

    // 链尾更新：吞掉异常，保证链条不断
    this.chains.set(userId, run.catch(() => {}));
    void run.catch(() => {});               // 未 await 前避免 unhandledRejection

    const cleanup = () => {
      if (this.chains.get(userId) === undefined) return;
      // 链空时回收，防 Map 无限增长
      run.finally(() => {
        const cur = this.chains.get(userId);
        if (cur && Object.is(cur, run.catch(() => {}))) this.chains.delete(userId);
      }).catch(() => {});
    };
    cleanup();

    return run;
  }

  stats(): { users: number; waiting: number; concurrency: number; active: number } {
    return {
      users: this.chains.size,
      waiting: this.waiting,
      concurrency: this.globalConcurrency,
      active: this.globalLimiter.activeCount,
    };
  }
}
