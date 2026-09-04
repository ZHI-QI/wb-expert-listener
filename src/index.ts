import { main } from "./boot.js";
import { migrate } from "./db/index.js";
import { getLogger } from "./log/logger.js";
import { loadConfig } from "./config.js";
import { createRealAgentRunner } from "./core/real-agent.js";

const cfg = loadConfig();
const log = getLogger();
migrate();
log.info({ event: "startup", port: cfg.port, kbMode: cfg.kb.mode }, "schema migrated, booting channels");

// Task 3：接入真实 AgentRunner（SDK 适配层）；echo 处理器仅作离线兜底
const useStub = process.env.WB_AGENT_STUB === "1";
const runner = useStub
  ? { chat: async (msg: { text: string }) => `[echo] ${msg.text}` } as never
  : await createRealAgentRunner();

await main({
  async handleMessage(msg, onProgress) {
    await onProgress("正在处理…");
    const text = await runner.chat(msg, onProgress);
    return { text };
  },
});

process.on("SIGINT", () => {
  log.info("sigint, shutting down");
  process.exit(0);
});
