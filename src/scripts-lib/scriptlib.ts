/**
 * scriptlib.ts — 脚本库对外门面（MCP Server 的 Task 6b 部分简化为门面模式：
 * AgentRunner 通过 allowedTools 里的 mcp__scriptlib__<name> 命中 → 这里执行）。
 *
 * 说明：SDK 的 mcpServers 配置在 real-agent.ts 中以 stdio 方式挂载本模块的
 * JSON-RPC 子进程；为控制复杂度，一期先以进程内门面实现（同一 API 面），
 * 二期如需跨进程隔离再切换 stdio MCP（接口不变）。
 */
import { scanScripts, type ScriptManifest } from "./manifest.js";
import { runScript, type RunResult } from "./runner.js";
import { getConfig } from "../config.js";

export interface ScriptCall {
  name: string;                  // manifest.name
  args: string[];                // CLI 形式参数：["--sql", "SELECT ..."]
}

export function listScripts(): ScriptManifest[] {
  const cfg = getConfig();
  return scanScripts(cfg.scripts.dir);
}

export function findScript(name: string): ScriptManifest | undefined {
  return listScripts().find((s) => s.name === name || s.file.endsWith(`${name}.py`));
}

/** Agent 唯一执行通道：按 manifest 超时控制，返回结构化结果。 */
export async function callScript(call: ScriptCall): Promise<RunResult & { manifest: ScriptManifest }> {
  const mf = findScript(call.name);
  if (!mf) throw new Error(`script not found: ${call.name}（可用：${listScripts().map((s) => s.name).join(", ")}）`);
  const result = await runScript(mf.file, call.args, mf.timeoutSec * 1000);
  return { ...result, manifest: mf };
}
