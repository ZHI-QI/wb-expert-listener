import pino from "pino";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) return logger;
  const cfg = getConfig();
  mkdirSync(cfg.logDir, { recursive: true });
  logger = pino(
    {
      level: process.env.WB_LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      base: { service: "wb-expert-listener" },
    },
    pino.destination({ dest: path.join(cfg.logDir, "app.log"), mkdir: true, sync: false }),
  );
  return logger;
}

export function newTraceId(): string {
  return randomUUID().slice(0, 8);
}

/** Child logger bound to a trace_id — use for every request-scoped log line. */
export function traceLogger(traceId: string, extra: Record<string, unknown> = {}): pino.Logger {
  return getLogger().child({ trace_id: traceId, ...extra });
}
