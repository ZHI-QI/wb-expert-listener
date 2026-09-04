import { createInterface } from "node:readline";
import type { ChannelAdapter, IncomingMessage, ReplySegment } from "./base.js";
import { newTraceId, traceLogger } from "../log/logger.js";

/**
 * CLI 测试渠道：终端一问一答，零外部依赖，用于开发调试核心链路。
 * userId 固定 cli:local（单终端单人）；Ctrl+D / exit 优雅退出。
 */
export function createCliChannel(userArg?: string): ChannelAdapter {
  const userId = userArg ?? "cli:local";
  let stopped = false;

  return {
    name: "cli",

    async start(onMessage) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const log = traceLogger("cli-boot", { channel: "cli" });
      log.info("CLI channel ready. Type a message (exit / Ctrl+D to quit).");

      const ask = () => rl.question("you> ", async (line) => {
        const text = line.trim();
        if (stopped) return;
        if (!text) { ask(); return; }
        if (text === "exit" || text === "quit") { rl.close(); return; }

        const msg: IncomingMessage = {
          channel: "cli",
          userId,
          text,
          msgId: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          traceId: newTraceId(),
        };
        try {
          await onMessage(msg);
        } catch (err) {
          traceLogger(msg.traceId, { channel: "cli" }).error({ err }, "cli message handling failed");
        }
        if (!stopped) ask();
      });
      ask();

      return () => {
        stopped = true;
        rl.close();
      };
    },

    async reply(_msg, segment: ReplySegment) {
      if (segment.type === "progress") {
        process.stdout.write(`  … ${segment.text}\n`);
      } else {
        process.stdout.write(`bot> ${segment.text}\n\n`);
      }
    },

    async healthy() {
      return !stopped;
    },
  };
}
