# setup.ps1 - Windows deployment (called by bootstrap.js or run manually)
# NOTE: ASCII-only output to avoid console encoding issues (per spec boundary)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Output "[setup] npm install (mirror)"
npm install --registry=https://registry.npmmirror.com
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Output "[setup] uv deps"
$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($uv) {
  $env:UV_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"
  uv sync
  if ($LASTEXITCODE -ne 0) { Write-Output "[setup] uv sync skipped" }
} else {
  Write-Output "[setup] uv missing - install via: powershell -c (irm https://astral.sh/uv/install.ps1 | iex)"
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Output "[setup] .env created - edit credentials"
}

Write-Output "[setup] pm2 start + autostart"
npx pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }
npx pm2 save

# Windows autostart: pm2-windows-service or Task Scheduler (manual step)
Write-Output "[setup] done. health: curl http://127.0.0.1:18790/health"
Write-Output "[setup] NOTE: for boot autostart run 'npx pm2-installer' or create a scheduled task"
