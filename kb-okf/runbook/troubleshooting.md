---
type: Runbook
title: 故障排查手册
description: 客服助手服务不响应时的标准自查步骤
tags: [runbook, ops]
timestamp: 2026-09-04T00:00:00Z
---

# 故障排查手册

## 服务完全不响应

1. `pm2 status` 确认进程是否 online
2. `curl 127.0.0.1:18790/health` 检查组件状态
3. `pm2 logs wb-expert-listener --lines 100` 查看最近错误

## 机器人不回复

1. 检查对应渠道健康状态（/health 输出的 channels 字段）
2. 微信客服：确认回调 5 秒内返回 success（看日志 timing）
3. ClawBot：确认本机 OpenClaw 网关进程存活
