import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import "dotenv/config";

export interface AppConfig {
  port: number;               // 管理 API / 渠道回调端口，只绑 127.0.0.1
  workspacesDir: string;      // 每用户工作空间根目录
  dbPath: string;
  logDir: string;
  pool: { core: number; max: number; keepAliveMs: number };
  queue: { globalConcurrency: number; dedupTtlMs: number };
  kb: { mode: "okf" | "ima"; okfDir: string; imaEndpoint?: string };
  admin: { notifyWebhook?: string };
  channels: {
    cli: { enabled: boolean };
    feishu: { enabled: boolean; appId?: string; appSecret?: string };
    wecom: { enabled: boolean; botId?: string; secret?: string };
    clawbot: { enabled: boolean; gatewayUrl?: string };
    wechatKf: { enabled: boolean; corpId?: string; secret?: string; token?: string; aesKey?: string };
  };
  scripts: { dir: string; uvIndexUrl: string; defaultTimeoutMs: number };
}

const ROOT = path.resolve(import.meta.dirname, "..");

function loadYamlOverlay(): Partial<AppConfig> | undefined {
  const p = process.env.WB_CONFIG ?? path.join(ROOT, "config.yaml");
  if (!existsSync(p)) return undefined;
  return parseYaml(readFileSync(p, "utf-8")) as Partial<AppConfig>;
}

function requireKeys(cfg: AppConfig): void {
  const missing: string[] = [];
  const check = (cond: boolean, key: string) => { if (!cond) missing.push(key); };
  check(Number.isFinite(cfg.port), "port");
  check(cfg.pool.core > 0, "pool.core");
  check(cfg.pool.max >= cfg.pool.core, "pool.max");
  check(cfg.kb.mode === "okf" || cfg.kb.mode === "ima", "kb.mode");
  if (missing.length > 0) {
    throw new Error(`[config] missing or invalid keys: ${missing.join(", ")} — check config.yaml / .env`);
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const yaml = loadYamlOverlay() ?? {};
  const env = process.env;

  const cfg: AppConfig = {
    port: Number(env.WB_PORT ?? 18790),
    workspacesDir: env.WB_WORKSPACES_DIR ?? path.join(ROOT, "workspaces"),
    dbPath: env.WB_DB_PATH ?? path.join(ROOT, "data", "app.db"),
    logDir: env.WB_LOG_DIR ?? path.join(ROOT, "logs"),
    pool: { core: 8, max: 20, keepAliveMs: 10 * 60_000 },
    queue: { globalConcurrency: 20, dedupTtlMs: 5 * 60_000 },
    kb: {
      mode: (env.WB_KB_MODE as "okf" | "ima") ?? "okf",
      okfDir: env.WB_KB_OKF_DIR ?? path.join(ROOT, "kb-okf"),
      imaEndpoint: env.WB_KB_IMA_ENDPOINT,
    },
    admin: { notifyWebhook: env.WB_ADMIN_WEBHOOK },
    channels: {
      cli: { enabled: env.WB_CHANNEL_CLI !== "false" },
      feishu: { enabled: env.WB_FEISHU_APP_ID !== undefined, appId: env.WB_FEISHU_APP_ID, appSecret: env.WB_FEISHU_APP_SECRET },
      wecom: { enabled: env.WB_WECOM_BOT_ID !== undefined, botId: env.WB_WECOM_BOT_ID, secret: env.WB_WECOM_SECRET },
      clawbot: { enabled: env.WB_CLAWBOT_ENABLED === "true", gatewayUrl: env.WB_CLAWBOT_GATEWAY },
      wechatKf: {
        enabled: env.WB_WECOM_KF_CORPID !== undefined,
        corpId: env.WB_WECOM_KF_CORPID,
        secret: env.WB_WECOM_KF_SECRET,
        token: env.WB_WECOM_KF_TOKEN,
        aesKey: env.WB_WECOM_KF_AESKEY,
      },
    },
    scripts: {
      dir: env.WB_SCRIPTS_DIR ?? path.join(ROOT, "scripts"),
      uvIndexUrl: env.UV_INDEX_URL ?? "https://pypi.tuna.tsinghua.edu.cn/simple",
      defaultTimeoutMs: 60_000,
    },
    ...yaml,
    ...overrides,
  };

  requireKeys(cfg);
  return cfg;
}

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}
export function resetConfigCache(): void { cached = null; }
