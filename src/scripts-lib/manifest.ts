/**
 * manifest.ts — 解析 scripts/*.py 的头注释声明，自动注册为脚本库工具。
 *
 * 约定（脚本头部 docstring）：
 *   name: 工具名（kebab/snake，即 mcp__scriptlib__<name>）
 *   description: 一句话用途（给 Agent 看）
 *   params: YAML-ish 列表（- name: 说明）
 *   timeout: 秒
 *   example: 调用示例
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface ScriptManifest {
  name: string;
  file: string;             // 绝对路径
  description: string;
  params: { name: string; desc: string }[];
  timeoutSec: number;
  example?: string;
}

export function parseManifest(file: string): ScriptManifest | null {
  if (!file.endsWith(".py")) return null;
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  // 取头部 docstring（第一对 """）
  const m = content.match(/"""([\s\S]*?)"""/);
  if (!m) return null;
  const doc = m[1];

  const name = doc.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!name) return null;  // 无 name 声明的脚本不注册

  const description = doc.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const timeout = Number(doc.match(/^timeout:\s*(\d+)/m)?.[1] ?? 60);
  const example = doc.match(/^example:\s*(.+)$/m)?.[1]?.trim();

  const params: { name: string; desc: string }[] = [];
  const paramBlock = doc.match(/^params:\n((?:\s+- .+\n?)+)/m)?.[1] ?? "";
  for (const line of paramBlock.split("\n")) {
    const pm = line.match(/^\s+-\s+([^:]+):\s*(.*)$/);
    if (pm) params.push({ name: pm[1].trim(), desc: pm[2].trim() });
  }

  return {
    name,
    file,
    description,
    params,
    timeoutSec: Number.isFinite(timeout) ? timeout : 60,
    example,
  };
}

export function scanScripts(dir: string): ScriptManifest[] {
  if (!existsSync(dir)) return [];
  const out: ScriptManifest[] = [];
  for (const f of readdirSync(dir)) {
    const mf = parseManifest(path.join(dir, f));
    if (mf) out.push(mf);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
