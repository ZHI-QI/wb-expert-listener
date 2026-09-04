/**
 * runner.ts — uv run 执行器：镜像加速 + 超时 kill + UTF-8 输出。
 * Windows 注意：spawn 用 shell:false + 绝对路径；输出强制 utf8。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { getConfig } from "../config.js";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
}

/** 跨平台强杀：Windows 用 taskkill /T 杀进程树（SIGKILL 对 py 子进程无效）。 */
function hardKill(child: ChildProcess, isWin: boolean): void {
  if (!child.pid) return;
  if (isWin) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

export async function runScript(
  scriptFile: string,
  args: string[],
  timeoutMs?: number,
): Promise<RunResult> {
  const cfg = getConfig();
  const limit = timeoutMs ?? cfg.scripts.defaultTimeoutMs;
  const started = Date.now();
  const isWin = process.platform === "win32";

  return new Promise<RunResult>((resolve) => {
    // uv run：<file> args…；UV_INDEX_URL 已在服务进程环境（.env）配置
    const child = spawn("uv", ["run", scriptFile, ...args], {
      cwd: path_dirname(scriptFile),
      env: { ...process.env, UV_INDEX_URL: cfg.scripts.uvIndexUrl, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: !isWin, // Unix 下新进程组，便于组杀
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      hardKill(child, isWin);
      // 兜底：即便 kill 信号丢失，也按超时语义返回
      setTimeout(() => finish({
        ok: false, stdout, stderr: stderr + "\n[timeout killed]", code: null,
        timedOut: true, durationMs: Date.now() - started,
      }), 2_000);
    }, limit);

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf-8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });
    child.on("error", (err) => {
      finish({
        ok: false, stdout, stderr: `${stderr}${err.message}`, code: null,
        timedOut, durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0 && !timedOut, stdout, stderr, code, timedOut, durationMs: Date.now() - started });
    });
  });
}

function path_dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? "." : p.slice(0, i);
}
