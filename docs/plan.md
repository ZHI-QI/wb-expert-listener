# Implementation Plan: wb-expert-listener

> 依据 docs/spec.md v1.0 · 2026-09-04 · 待审阅
> 原则：垂直切片（每任务交付可运行功能）、依赖先行、高风险前置、每 2-3 任务设检查点

## Overview

单机监听服务：4 渠道适配 → 会话池（Agent SDK）→ 脚本库 MCP / 知识库路由 → 日志/总结/运维。跨 Linux/Windows，专家初始化一条命令部署。开发节奏：**CLI 测试渠道先跑通核心链路，再逐个接真实渠道**。

## Architecture Decisions

| 决策 | 理由 |
|---|---|
| CLI 渠道先行，真实渠道后接 | 核心链路（池/队列/日志）零外部依赖即可端到端验证，降调试成本 |
| 会话池 + 冷路径拒绝策略 | 线程池模式验证成熟，内存可控（max=20），热会话毫秒复用 |
| 脚本库 MCP 作为唯一执行通道 | allowedTools 收口，机制性杜绝 Agent 越权 |
| OKF 完整实现、ima stub + 接口预留 | ima 凭据未定（Open Question #1），不阻塞主线 |
| 单仓库 + bootstrap 平台分支 | 运行时代码 100% 共享，只部署层分 *nix/win |
| SQLite WAL | 单机免运维，同步 API 简化并发 |

## Task List

### Phase 1: Foundation（地基，3 任务）

- [ ] **Task 1: 项目脚手架 + 配置 + SQLite 初始化**
  - 脚手架：package.json（ESM/strict）、tsconfig、eslint、vitest、pino 日志（trace_id 中间件）、config.ts（YAML+env 合并，.env.example）
  - 建表：user_sessions / chat_logs / summaries / script_audit / kv（迁移脚本 schema.sql）
  - Acceptance: `npm run dev` 起服务，5 张表自动创建；配置缺项启动即报错并指明缺失 key
  - Verify: `npm test`（config 加载用例）通过；`sqlite3 data/app.db .tables` 见 5 表
  - Files: package.json, tsconfig, src/config.ts, src/log/*.ts, src/db/*.ts, schema.sql
  - Dependencies: None · Scope: M

- [ ] **Task 2: 渠道接口 + CLI 测试渠道 + 问答日志**
  - ChannelAdapter 接口（onMessage/reply/健康自检）+ 注册表；cli.ts 实现终端一问一答
  - 问答全量落库（user_id/channel/session_id/role/content/tokens/trace_id），JSONL 双写
  - Acceptance: 终端输入 → 应答 → chat_logs 两条记录（user+assistant）；Ctrl+D 优雅退出
  - Verify: `npm test -- cli-channel`；手工跑一轮查库
  - Files: src/channels/base.ts, src/channels/cli.ts, src/log/store.ts
  - Dependencies: Task 1 · Scope: M

- [ ] **Task 3: AgentRunner 适配层（SDK 会话 create/resume + allowedTools 收口）**
  - agent.ts 封装 query/unstable_v2_createSession/resumeSession；初始化消息捕获 session_id 落 user_sessions；systemPrompt 注入知识库使用规范
  - allowedTools 白名单：Read/Grep/Glob（脚本库 MCP 就绪后再加入）
  - Acceptance: 两轮对话第二问引用第一问上下文；不同 user_id cwd 隔离；模拟请求 Bash 被拒（SC2/3/7 部分）
  - Verify: `npm test -- agent-runner`（SDK 打桩：session_id 返回与 resume 调用断言）
  - Files: src/core/agent.ts, src/core/session-pool.ts(骨架)
  - Dependencies: Task 2 · Scope: M

**✅ Checkpoint 1（Tasks 1-3 后，人工评审点）：** CLI 端到端跑通（SC1/2/3/5 基本面）；全测试绿；**经 boos王 确认后进入 Phase 2**

### Phase 2: Core Features（核心，5 任务）

- [ ] **Task 4: 会话池完整实现（热/冷双路径 + LRU 淘汰）**
  - core=8/max=20/keepAlive=10min；acquire 四分支；sweeper 定时回收；池满冷路径 query({resume}) 单轮
  - Acceptance: SC4——mock 池满场景，第 21 个用户走冷路径返回正确；LRU 淘汰后原用户 resume 找回上下文
  - Verify: `npm test -- session-pool`（LRU/冷路径/并发 acquire ≥10 用例）
  - Files: src/core/session-pool.ts
  - Dependencies: Task 3 · Scope: M

- [ ] **Task 5: 用户级队列 + 全局并发控制**
  - 同 user_id 串行（保上下文顺序），跨用户并行，全局 p-limit；消息去重（msg_id LRU）；超载排队提示
  - Acceptance: 同用户 3 条连发按序处理不串上下文；并发 50 压测无未捕获异常
  - Verify: `npm test -- queue`（顺序性 + 并发上限用例）
  - Files: src/core/queue.ts
  - Dependencies: Task 4 · Scope: M

- [ ] **Task 6: Python 脚本库 MCP（注册/执行/审计）**
  - manifest.ts 解析脚本头注释；mcp-server.ts 注册为 mcp__scriptlib__<name>；runner.ts uv run（UV_INDEX_URL 镜像）+ 超时 kill + 输出 UTF-8；watcher.ts chokidar 监听 → script_audit 落库 + 管理员通知
  - 内置脚本：db_query.py（只读账号+SQL 白名单校验）、ingest_okf.py（Phase 3 用）、export_xlsx.py、web_search.py
  - Acceptance: SC7/SC8——Agent 调 db_query 成功返回；新增脚本文件 30s 内注册可用且审计有记录有通知
  - Verify: `npm test -- scriptlib`（manifest/超时/白名单）；uv run db_query.py 手工冒烟
  - Files: src/scripts-lib/*, scripts/db_query.py, scripts/export_xlsx.py
  - Dependencies: Task 3 · Scope: L（拆 6a manifest+runner / 6b mcp-server / 6c watcher+内置脚本，若超限）

- [ ] **Task 7: OKF 知识库（检索 + git 版本化）**
  - kb-okf/ git init + index.md + 示例 concept；okf.ts 检索：index.md 渐进导航 + Grep 关键词；router.ts kb.mode 单选热切换（kv 表）；ima.ts stub（启动探测凭据，缺省提示）
  - Acceptance: SC6——切换 mode 立即生效，检索只走当前模式；OKF 问答命中 concept 内容
  - Verify: `npm test -- kb`（router 切换 + okf 检索命中）
  - Files: src/kb/*.ts, kb-okf/**
  - Dependencies: Task 3 · Scope: M

- [ ] **Task 8: 飞书渠道 + 企微渠道（真实渠道首发）**
  - feishu.ts（事件回调验签/去重/回复 API）、wecom.ts（智能机器人长连接 aibot_subscribe/aibot_msg_callback + response_url 回复）；凭证 .env 配置；渠道级健康自检
  - Acceptance: 真实飞书/企微机器人一问一答（SC1 真渠道版）；断网重连自动恢复
  - Verify: 手工两渠道冒烟 + `npm test -- channels`（打桩验签/去重）
  - Files: src/channels/feishu.ts, src/channels/wecom.ts
  - Dependencies: Tasks 5,7 · Scope: L

**✅ Checkpoint 2（Tasks 4-8 后）：** 飞书/企微真实消息端到端；会话池压测报告（并发 50）；脚本库审计通知链路通；**人工评审后进入 Phase 3**

### Phase 3: Polish（补全，5 任务）

- [ ] **Task 9: OKF 上传转化 Web 页面（本地 HTML）**
  - web/：单文件 HTML（拖拽上传 docx/pdf/xlsx/md/txt + type 下拉 + tags）→ 调 scripts/ingest_okf.py → 章节切分 → frontmatter 生成 → kb-okf/ 落盘 + index.md 重建 + git commit；仅绑 127.0.0.1
  - Acceptance: SC9——上传一份 docx，kb-okf 新增 concept，index.md 更新，git log 有 commit
  - Verify: 手工上传 3 种格式冒烟 + ingest 单测
  - Files: src/web/, scripts/ingest_okf.py, web/okf-upload.html
  - Dependencies: Task 7 · Scope: M

- [ ] **Task 10: 微信 ClawBot + 微信客服渠道**
  - clawbot.ts（对接本机 OpenClaw 网关，含网关健康探测与启动提示）、wechat-kf.ts（回调 5s 秒回 success + 异步客服消息回复 + msgid 幂等）
  - Acceptance: 两渠道真实消息收发；客服回调重复推送不重复回答
  - Verify: 手工冒烟 + 幂等单测
  - Files: src/channels/clawbot.ts, src/channels/wechat-kf.ts
  - Dependencies: Task 8 · Scope: L

- [ ] **Task 11: 自动问题总结**
  - 会话结束信号（空闲 30min）或每 10 轮触发；复用主会话或小模型生成「分类+摘要+是否解决」入 summaries；FAQ 候选标记
  - Acceptance: SC11——一轮问答结束 30min 后 summaries 表有记录；/admin/summaries 可查
  - Verify: 定时器打桩单测 + 手工查询
  - Files: src/summary/*.ts
  - Dependencies: Task 5 · Scope: S

- [ ] **Task 12: 运维面（/health /metrics 告警）**
  - /health（组件状态汇总）、/metrics（活跃会话/P95 延迟/错误率/脚本失败率/队列深度，Prometheus 文本格式）；连续失败 3 次推管理员；日志按天轮转
  - Acceptance: SC12——pm2 kill 后自动重启；/metrics 指标与实际一致
  - Verify: curl 冒烟 + kill -9 恢复演练
  - Dependencies: Task 5 · Scope: M

- [ ] **Task 13: 跨平台部署（bootstrap + setup.sh + setup.ps1）**
  - bootstrap.js 检测 process.platform 分流；setup.sh（uv 镜像 + pm2 + 可选 systemd）；setup.ps1（纯 ASCII 输出；pm2 开机自启）；git autocrlf 处理；ecosystem.config.js
  - Acceptance: SC10——Linux 与 Windows 各一次全新目录部署成功，专家初始化一条命令完成
  - Verify: 双平台各跑 bootstrap → pm2 status healthy → CLI 渠道冒烟
  - Files: deploy/*, ecosystem.config.js
  - Dependencies: Task 12 · Scope: M

**✅ Checkpoint 3（全部完成后）：** SC1–SC12 逐条验收 → 代码评审（五轴）→ 打 tag v1.0.0

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| v2 Session API unstable 变动 | 高 | agent.ts 适配层隔离，变更只改一处 |
| ima 凭据迟迟不定 | 中 | Phase 3 前仅需 stub，不阻塞；router 接口已预留 |
| 每会话一 CLI 子进程内存压力 | 高 | 池上限 20 + LRU + 冷路径；Checkpoint 2 压测验证 |
| ClawBot 网关依赖用户环境 | 中 | 适配器健康探测 + 引导提示，不阻塞其他渠道 |
| Windows 编码/路径坑 | 中 | setup.ps1 纯 ASCII；path.join 全局约定；Task 13 双平台验收 |
| 微信客服 5s 超时 | 中 | 秒回 success + 异步回复架构内置（Task 10 验收项） |

## Parallelization Opportunities

- 可并行：Task 6（脚本库）‖ Task 7（知识库）——互不依赖，仅共享 Task 3 的接口
- 必须串行：1→2→3→4→5（核心链路）；8 依赖 5+7；10 依赖 8；13 最后
- 需协调：Task 6b 与 Task 3 的 allowedTools 联动（先定 MCP 工具命名约定 mcp__scriptlib__*）

## Open Questions（与 spec §9 同步）

1. ima API 凭据（Phase 3 前给即可）
2. 管理员通知默认飞书 webhook，可否？
3. 渠道上线路序 CLI→企微→飞书→ClawBot→微信客服，认可？
4. 部署机内存规格（定 pool.max，默认 20）
5. OKF 初始内容（空包 or 先灌 FAQ）
