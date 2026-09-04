/**
 * okf.ts — OKF Bundle 检索：index.md 渐进导航 + frontmatter 标签 + 关键词全文匹配。
 * 零外部依赖（不引向量库）：客服场景词条量级小，关键词+tags 足够。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface OkfConcept {
  id: string;              // 相对路径去 .md（spec：concept ID = path）
  title: string;
  description: string;
  tags: string[];
  body: string;
  file: string;
}

export function parseConcept(file: string, root: string): OkfConcept | null {
  if (!file.endsWith(".md")) return null;
  if (file.endsWith("index.md") || file.endsWith("log.md")) return null; // 保留文件名
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return null;

  const get = (key: string) => fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  const tags = (fm[1].match(/^tags:\s*\[(.*)\]$/m)?.[1] ?? "")
    .split(",").map((t) => t.trim()).filter(Boolean);

  const body = raw.slice(fm[0].length);
  return {
    id: path.relative(root, file).replace(/\\/g, "/").replace(/\.md$/, ""),
    title: get("title") || path.basename(file, ".md"),
    description: get("description"),
    tags,
    body,
    file,
  };
}

export function loadBundle(root: string): OkfConcept[] {
  if (!existsSync(root)) return [];
  const out: OkfConcept[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const c = parseConcept(p, root);
        if (c) out.push(c);
      }
    }
  };
  walk(root);
  return out;
}

export interface OkfHit {
  concept: OkfConcept;
  score: number;
  snippet: string;
}

/** 简易相关性评分：标题命中 > tags > 描述 > 正文关键词密度。 */
export function searchOkf(query: string, root: string, topN = 3): OkfHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const hits: OkfHit[] = [];

  for (const c of loadBundle(root)) {
    const title = c.title.toLowerCase();
    const desc = c.description.toLowerCase();
    const body = c.body.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 10;
      if (c.tags.some((tag) => tag.toLowerCase().includes(t))) score += 6;
      if (desc.includes(t)) score += 3;
      const occurrences = body.split(t).length - 1;
      score += Math.min(occurrences, 5);
    }
    if (score > 0) {
      const idx = Math.max(0, body.indexOf(terms[0]) - 40);
      hits.push({ concept: c, score, snippet: body.slice(idx, idx + 200).trim() });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, topN);
}
