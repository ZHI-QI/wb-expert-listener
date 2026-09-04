#!/usr/bin/env bash
# setup.sh — Linux/macOS 部署（由 bootstrap.js 调用或手动执行）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[setup] npm install (mirror)"
npm install --registry=https://registry.npmmirror.com

echo "[setup] uv deps"
if command -v uv >/dev/null 2>&1; then
  UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv sync || echo "[setup] uv sync skipped"
else
  echo "[setup] uv missing — install: curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[setup] .env created — edit credentials"
fi

echo "[setup] pm2 start + autostart"
npx pm2 start ecosystem.config.cjs || true
npx pm2 save || true
npx pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || echo "[setup] pm2 startup: run manually"

echo "[setup] done. health: curl http://127.0.0.1:18790/health"
