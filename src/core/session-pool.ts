/**
 * SessionPool — 线程池模式的会话池移植（spec §4.2）。
 *
 * acquire(userId) 四分支：
 *   1. 热命中：池内该用户会话空闲 → 直接复用（毫秒级）
 *   2. 池有空位 → resumeToPool 重建入池
 *   3. 池满 → 淘汰最久空闲的 LRU 会话（close 进程，session_id 留库）腾位
 *   4. 全忙（无空闲可淘汰）→ 冷路径：query({resume}) 单轮一问一答，不占池位
 *
 * SDK 细节经 deps 注入（真实实现/测试桩共用本逻辑）。
 */

export interface PooledSession {
  userId: string;
  state: "idle" | "busy";
  lastUsed: number;
  /** 常驻会话的多轮句柄。 */
  send(text: string, onProgress?: (t: string) => void): Promise<string>;
  /** 关闭底层 CLI 进程；session_id 已持久化在库里，可随时 resume 找回。 */
  close(): Promise<void>;
}

export interface PoolDeps {
  /** 重建该用户的常驻会话（resume 或 create）。返回 null 表示无法重建。 */
  resumeToPool(userId: string): Promise<PooledSession | null>;
  /** 冷路径：单轮 query+resume，跑完进程即退，不占池位。 */
  coldQuery(userId: string, text: string, onProgress?: (t: string) => void): Promise<string>;
  now(): number;
}

export interface PoolStats {
  size: number;
  busy: number;
  idle: number;
  core: number;
  max: number;
  coldPathCount: number;
  lruEvictions: number;
}

export class SessionPool {
  private pool = new Map<string, PooledSession>(); // userId → session（Map 保插入序 = LRU 序）
  private tail: PooledSession | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  coldPathCount = 0;
  lruEvictions = 0;

  constructor(
    private deps: PoolDeps,
    private core = 8,
    private max = 20,
    private keepAliveMs = 10 * 60_000,
  ) {}

  /** 获取执行通道：热会话 / 重建入池 / 冷路径。返回执行函数与释放函数。 */
  async acquire(userId: string): Promise<{
    kind: "hot" | "warm" | "cold";
    run: (text: string, onProgress?: (t: string) => void) => Promise<string>;
    release: () => void;
  }> {
    const entry = this.pool.get(userId);
    if (entry && entry.state === "idle") {
      entry.state = "busy";
      entry.lastUsed = this.deps.now();
      return {
        kind: "hot",
        run: (t, p) => entry.send(t, p),
        release: () => this.release(userId),
      };
    }

    // 池有空位 → 重建入池（warm）
    if (this.pool.size < this.max) {
      const s = await this.deps.resumeToPool(userId);
      if (s) {
        s.state = "busy";
        this.pool.set(userId, s);
        this.touch(s);
        return {
          kind: "warm",
          run: (t, p) => s.send(t, p),
          release: () => this.release(userId),
        };
      }
    } else {
      // 池满 → 淘汰一个空闲 LRU 腾位
      const victim = this.findLRUIdle();
      if (victim) {
        await victim.close().catch(() => {});
        this.pool.delete(victim.userId);
        this.lruEvictions++;
        const s = await this.deps.resumeToPool(userId);
        if (s) {
          s.state = "busy";
          this.pool.set(userId, s);
          this.touch(s);
          return {
            kind: "warm",
            run: (t, p) => s.send(t, p),
            release: () => this.release(userId),
          };
        }
      }
    }

    // 全忙或重建失败 → 冷路径（拒绝策略：不阻塞，单轮直答）
    this.coldPathCount++;
    return {
      kind: "cold",
      run: (t, p) => this.deps.coldQuery(userId, t, p),
      release: () => {},
    };
  }

  private release(userId: string): void {
    const s = this.pool.get(userId);
    if (s) {
      s.state = "idle";
      s.lastUsed = this.deps.now();
      this.touch(s);
    }
  }

  /** Map 删除重插实现 LRU 顺序（最近使用在尾）。 */
  private touch(s: PooledSession): void {
    this.pool.delete(s.userId);
    this.pool.set(s.userId, s);
  }

  private findLRUIdle(): PooledSession | null {
    for (const s of this.pool.values()) if (s.state === "idle") return s;
    return null;
  }

  /** 启动定时回收空闲超时会话（保 core 数量）。 */
  startSweeper(intervalMs = 60_000): void {
    this.stopSweeper();
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
    this.sweepTimer.unref?.();
  }

  sweep(): void {
    const now = this.deps.now();
    for (const s of [...this.pool.values()]) {
      if (s.state === "idle" && now - s.lastUsed > this.keepAliveMs && this.pool.size > this.core) {
        s.close().catch(() => {});
        this.pool.delete(s.userId);
      }
    }
  }

  stopSweeper(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async closeAll(): Promise<void> {
    for (const s of this.pool.values()) await s.close().catch(() => {});
    this.pool.clear();
  }

  stats(): PoolStats {
    let busy = 0;
    for (const s of this.pool.values()) if (s.state === "busy") busy++;
    return {
      size: this.pool.size,
      busy,
      idle: this.pool.size - busy,
      core: this.core,
      max: this.max,
      coldPathCount: this.coldPathCount,
      lruEvictions: this.lruEvictions,
    };
  }

  /** 供测试注入。 */
  setTailForTest(s: PooledSession | null): void { this.tail = s; }
}
