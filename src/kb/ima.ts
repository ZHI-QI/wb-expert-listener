/**
 * ima.ts — ima 知识库适配器（stub）。
 * 凭据/endpoint 未定（spec Open Question #1）：启动探测，缺失时健康报 degraded，
 * 检索抛出明确错误并建议切回 okf 模式。
 */
import { getConfig } from "../config.js";

export interface ImaClient {
  healthy(): Promise<boolean>;
  search(query: string, topN?: number): Promise<{ title: string; snippet: string; url?: string }[]>;
}

export function createImaClient(): ImaClient {
  const cfg = getConfig();
  const endpoint = cfg.kb.imaEndpoint;

  return {
    async healthy() {
      if (!endpoint) return false;
      try {
        const res = await fetch(endpoint, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
        return res.ok;
      } catch {
        return false;
      }
    },

    async search(_query: string) {
      if (!endpoint) {
        throw new Error("ima 知识库未配置（WB_KB_IMA_ENDPOINT 为空）——请先配置凭据或切回 kb.mode=okf");
      }
      // TODO(Phase 3)：接入 ima 真实检索 API
      throw new Error("ima 检索将在 Phase 3 接入：当前请使用 kb.mode=okf");
    },
  };
}
