/**
 * metrics.ts — 轻量指标收集：计数器 + 直方图（P95），Prometheus 文本格式输出。
 * 零依赖实现（单机场景不需要 client 库）。
 */

interface Histogram {
  name: string;
  values: number[];
  maxSamples: number;
}

const counters = new Map<string, number>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, () => number>();

export function incCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function observeLatency(name: string, ms: number): void {
  let h = histograms.get(name);
  if (!h) {
    h = { name, values: [], maxSamples: 5_000 };
    histograms.set(name, h);
  }
  h.values.push(ms);
  if (h.values.length > h.maxSamples) h.values.splice(0, h.values.length - h.maxSamples);
}

export function setGauge(name: string, getter: () => number): void {
  gauges.set(name, getter);
}

export function percentile(name: string, p: number): number {
  const h = histograms.get(name);
  if (!h || h.values.length === 0) return 0;
  const sorted = [...h.values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function counterValue(name: string): number {
  return counters.get(name) ?? 0;
}

/** Prometheus 文本格式（text/plain; version=0.0.4）。 */
export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [name, v] of counters) {
    lines.push(`# TYPE ${name} counter`, `${name} ${v}`);
  }
  for (const [name, getter] of gauges) {
    lines.push(`# TYPE ${name} gauge`, `${name} ${getter()}`);
  }
  for (const h of histograms.values()) {
    const sorted = [...h.values].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
    lines.push(`# TYPE ${h.name} summary`,
      `${h.name}{quantile="0.5"} ${at(50)}`,
      `${h.name}{quantile="0.95"} ${at(95)}`,
      `${h.name}_count ${h.values.length}`);
  }
  return lines.join("\n") + "\n";
}
