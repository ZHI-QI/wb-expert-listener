/**
 * real-agent.ts — 真实 SDK 实现（延迟 import，测试环境不加载）。
 * SDK v2 Session API 是 unstable_ 前缀；本文件是唯一 import SDK 的地方。
 */
import type { AgentRunner } from "./agent.js";
import {
  READONLY_TOOLS, loadUserSession, saveUserSession, workspaceFor, appendChatLog,
} from "./agent.js";
import { getConfig } from "../config.js";
import { traceLogger } from "../log/logger.js";
import type { IncomingMessage } from "../channels/base.js";

export async function createRealAgentRunner(): Promise<AgentRunner> {
  // 延迟加载：vitest 环境/SDK 未安装时不会在 import 阶段炸掉
  const sdk = await import("@tencent-ai/agent-sdk");
  const cfg = getConfig();

  const baseOptions = {
    model: process.env.WB_MODEL ?? "deepseek-v3.1",
    fallbackModel: process.env.WB_FALLBACK_MODEL,
    allowedTools: [...READONLY_TOOLS], // mcp__scriptlib__* 在 Task 6 加入
    permissionMode: "default" as const,
    settingSources: [] as string[],    // 默认不加载本机配置（服务化隔离）
    maxTurns: Number(process.env.WB_MAX_TURNS ?? 30),
  };

  return {
    async ensureSession(userId: string) {
      const cwd = workspaceFor(userId);
      return { sessionId: loadUserSession(userId).sessionId ?? "", cwd };
    },

    async chat(msg: IncomingMessage, onProgress) {
      const log = traceLogger(msg.traceId, { userId: msg.userId, channel: msg.channel });
      const { sessionId, cwd } = loadUserSession(msg.userId);
      const opts = { ...baseOptions, cwd, resume: sessionId ?? undefined };

      log.info({ resumed: Boolean(sessionId) }, "agent query start");
      const q = sdk.query({ prompt: msg.text, options: opts as never });

      let answer = "";
      for await (const message of q as AsyncIterable<Record<string, unknown>>) {
        const m = message as { type?: string; subtype?: string; session_id?: string; message?: { content?: Array<{ type: string; text?: string }> }; duration_ms?: number };
        if (m.type === "system" && m.subtype === "init" && m.session_id) {
          saveUserSession(msg.userId, m.session_id, cwd);
        }
        if (m.type === "assistant" && m.message?.content) {
          for (const c of m.message.content) {
            if (c.type === "text" && c.text) answer = c.text;
          }
        }
        if (m.type === "result") {
          log.info({ duration_ms: m.duration_ms }, "agent query done");
        }
      }

      if (!answer) answer = "（模型未返回文本，请稍后重试）";
      appendChatLog({ userId: msg.userId, channel: msg.channel, role: "assistant", content: answer, traceId: msg.traceId });
      void onProgress; // 流式进度在 Task 5 队列接入后细分，当前一次性返回
      void cfg;
      return answer;
    },
  };
}
