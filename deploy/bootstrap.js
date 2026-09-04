#!/usr/bin/env node
/**
 * bootstrap.js — 跨平台初始化部署唯一入口（SC10）。
 * 流程：平台检测 → 环境预检 → npm 依赖（国内镜像）→ uv 依赖 → pm2 守护注册 → 冒烟提示。
 * 用法：node deploy/bootstrap.js
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const IS_WIN = process.platform === "win32";
const NPM_REGISTRY = "https://registry.npmmirror.com";
const UV_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple";

const log = (msg) => console.log(`[bootstrap] ${msg}`);
const die = (msg) => { console.error(`[bootstrap][FATAL] ${msg}`); process.exit(1); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: IS_WIN, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  return r;
}

function checkEnv() {
  log(`platform: ${process.platform} (win=${IS_WIN})`);
  for (const tool of ["node", "git"]) {
    try { run(tool, ["--version"], { stdio: "pipe" }); }
    catch { die(`${tool} not found — install it first`); }
  }
  // uv 可选（缺失时提示，不阻塞）
  try { run("uv", ["--version"], { stdio: "pipe" }); log("uv: ok"); }
  catch { log("uv: MISSING (script library will not run; install via https://docs.astral.sh/uv/)"); }
}

function installDeps() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) die("not in project root (package.json missing)");
  log("npm install (mirror)…");
  run("npm", ["install", "--registry", NPM_REGISTRY], { cwd: ROOT });

  log("python script deps via uv…");
  try {
    run("uv", ["sync"], { cwd: ROOT, env: { ...process.env, UV_INDEX_URL: UV_INDEX } });
  } catch { log("uv sync skipped/failed — scripts will lazy-install on first run"); }
}

function writeEnvIfAbsent() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(ROOT, ".env.example"), envPath);
    log(`.env created from template — EDIT IT: ${envPath}`);
  }
}

function registerPm2() {
  log("pm2: install (if needed) + start…");
  run("npm", ["exec", "--", "pm2", "start", "ecosystem.config.cjs"], { cwd: ROOT });
  try {
    run("npm", ["exec", "--", "pm2", "save"], { cwd: ROOT });
    const sub = IS_WIN ? ["npm", ["exec", "--", "pm2", "startUP", "install"]] : ["pm2", ["startup"]];
    run(sub[0], sub[1], { cwd: ROOT });
  } catch { log("pm2 autostart setup skipped (manual: pm2 save && pm2 startup)"); }
}

function smokeHint() {
  log("done. next steps:");
  log("  1) edit .env (channel credentials)");
  log("  2) pm2 logs wb-expert-listener");
  log("  3) health: curl http://127.0.0.1:18790/health");
  log("  4) CLI channel smoke: pm2 attach wb-expert-listener (or npm run dev)");
}

function main() {
  checkEnv();
  installDeps();
  writeEnvIfAbsent();
  registerPm2();
  smokeHint();
}

try { main(); } catch (err) { die(err.message); }
