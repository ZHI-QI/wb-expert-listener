import { main } from "./boot.js";
import { migrate } from "./db/index.js";
import { getLogger } from "./log/logger.js";
import { loadConfig } from "./config.js";
import { createRealAgentRunner } from "./core/real-agent.js";
import { UserQueue } from "./core/queue.js";
import { incCounter, observeLatency, reportOutcome } from "./ops/ops.js";

const cfg = loadConfig();
const log = getLogger();
migrate();
log.info({ event: "startup", port: cfg.port, kbMode: cfg.kb.mode }, "schema migrated, booting channels");

// AgentRunner：真实 SDK / stub echo（离线调试）
const useStub = process.env.WB_AGENT_STUB === "1";
const runner = useStub
  ? { chat: async (msg: { text: string }) => `[echo] ${msg.text}` } as never
  : await createRealAgentRunner();

// 用户级队列：同用户串行、跨用户并行、全局限额（Task 5）
const queue = new UserQueue(cfg.queue.globalConcurrency);

await main({
  async handleMessage(msg, onProgress) {
    // 同一用户串行（保上下文顺序），跨用户并行（Task 5）
    return queue.submit(msg.userId, async () => {
      const t0 = Date.now();
      try {
        await onProgress("正在处理…");
        const text = await runner.chat(msg, onProgress);
        observeLatency("wb_chat_latency_ms", Date.now() - t0);
        incCounter("wb_chats_ok_total");
        reportOutcome("chat", true);
        return { text };
      } catch (err) {
        incCounter("wb_chats_failed_total");
        reportOutcome("chat", false);
        throw err;
      }
    });
  },
  ops: { queue, startedAt: Date.now() },
});

process.on("SIGINT", () => {
  log.info("sigint, shutting down");
  process.exit(0);
});
