# Spec: wb-expert-listener（WorkBuddy 客服/助手专家·监听服务）

> 版本 v1.0 · 2026-09-04 · 状态：待 boos王 审阅
> 本 spec 是唯一需求事实源（single source of truth），实现中发现偏差先改这里再改代码。

## 1. Objective（目标）

在每个用户电脑上运行一个**单机轻量监听服务**：接收飞书机器人 / 企微机器人 / 微信 ClawBot / 微信客服四个渠道的用户消息，按 user_id 路由到对应工作空间的 WorkBuddy 会话（CodeBuddy Agent SDK），并将 AI 回答回推渠道。服务由专家初始化流程 `git clone` 拉取部署，跨 Linux / Windows。

**用户故事：**
- 作为终端用户，我在飞书/企微/微信里给机器人发消息，AI 带着我的历史上下文回答
- 作为管理员（boos王），我能查所有问答日志、切换知识库、增删脚本、收到异常告警
- 作为运维者，我用 `git pull && pm2 reload` 即可升级，`pm2 logs` 即可排障

**成功判据（可测试）：**
- SC1 单渠道（CLI 测试渠道）端到端跑通：消息 → 会话 → 回答 → 日志落库
- SC2 同一用户连续两问，第二问能引用第一问上下文（会话恢复生效）
- SC3 两个不同用户同时提问，各自回答不串（会话隔离生效）
- SC4 池满时新用户请求走冷路径（query+resume）且正常返回
- SC5 问答日志含 user_id/channel/session_id/role/content/tokens/created_at，可 SQL 查询
- SC6 `kb.mode` 切换 okf↔ima 热生效，检索只走当前模式
- SC7 Agent 只能通过脚本库工具执行操作，直接请求 Bash/Write 被拒绝
- SC8 新增/修改脚本 → 审计日志落库 + 管理员通知
- SC9 上传 docx/pdf/xlsx/md 文件 → OKF concept 生成 + index.md 重建 + git commit
- SC10 Linux 与 Windows 各完成一次全新部署（bootstrap 一条命令）
- SC11 会话结束（或每 10 轮）自动生成问题总结入库
- SC12 pm2 kill 后自动重启；/health 与 /metrics 正常返回

## 2. Tech Stack（技术栈）

| 层 | 选型 | 版本约束 |
|---|---|---|
| 运行时 | Node.js（TS ESM） | ≥18，推荐 22 |
| Agent | @tencent-ai/agent-sdk | ≥0.1.0；v2 Session API 为 unstable，用适配层隔离 |
| Web | Express（管理 API + 渠道回调） | 4.x，不引重型框架 |
| 队列 | p-limit + 内存用户级串行队列 | 无外部 MQ |
| 存储 | SQLite（better-sqlite3） | WAL 模式 |
| 脚本运行时 | Python + uv（国内镜像 UV_INDEX_URL） | Python ≥3.10 |
| 脚本桥 | 自研轻量 MCP Server（stdio，@modelcontextprotocol/sdk） | scripts/*.py 头注释自动注册 |
| 知识库 | OKF（Markdown+YAML frontmatter，git 版本化）/ ima（接口预留） | OKF 规范 v0.1 |
| 文件监听 | chokidar | 4.x |
| 守护 | pm2（Linux 可选 systemd 单元） | 5.x |
| 日志 | pino 结构化 + 按天轮转 | 含 trace_id |
| 监控 | /health + /metrics（Prometheus 文本格式） | 可选推送 Grafana/飞书 |

## 3. Commands（命令）

```bash
# 开发
npm install
npm run dev                 # tsx 热重载，端口 18790
# 测试与构建
npm test                    # vitest，全量
npm test -- session-pool    # 单文件
npm run build               # tsc → dist/
npm run lint                # eslint --fix
# 运行与运维
npm run start               # node dist/index.js
pm2 start ecosystem.config.js
pm2 reload wb-expert-listener        # 平滑重启（git pull 后）
pm2 logs wb-expert-listener
pm2 monit
# 脚本库（Python 侧）
uv sync                     # 装脚本依赖（走镜像）
uv run python scripts/db_query.py --help
# 初始化部署（专家首次执行）
node deploy/bootstrap.js            # 自动识别平台 → 调 setup.sh / setup.ps1
```

## 4. Project Structure（项目结构）

```
wb-expert-listener/
├── src/
│   ├── channels/          # 渠道适配器（实现 ChannelAdapter 接口）
│   │   ├── base.ts        #   接口定义 + 注册表
│   │   ├── cli.ts         #   CLI 测试渠道（开发调试用，零外部依赖）
│   │   ├── feishu.ts      #   飞书长连接/事件回调
│   │   ├── wecom.ts       #   企微智能机器人长连接
│   │   ├── clawbot.ts     #   微信 ClawBot（经本机 OpenClaw 网关）
│   │   └── wechat-kf.ts   #   微信客服回调（5s 秒回 + 异步回复）
│   ├── core/
│   │   ├── session-pool.ts    # 会话池（线程池模式移植，热/冷双路径）
│   │   ├── queue.ts           # 用户级串行 + 全局并发上限
│   │   ├── agent.ts           # AgentRunner：SDK 适配层（隔离 unstable API）
│   │   └── reply.ts           # 回复路由：流式分段 → 渠道推送
│   ├── kb/
│   │   ├── router.ts      # kb.mode 单选热切换
│   │   ├── okf.ts         # OKF 检索（index.md 渐进 + Grep）
│   │   └── ima.ts         # ima 适配器（Phase 3 前为 stub，启动时探测凭据）
│   ├── scripts-lib/
│   │   ├── mcp-server.ts  # 脚本注册为 MCP 工具
│   │   ├── runner.ts      # uv run 执行器：超时/编码/资源限制
│   │   ├── watcher.ts     # chokidar 监听 scripts/ → 审计+通知
│   │   └── manifest.ts    # 脚本头注释解析（名称/用途/参数/超时）
│   ├── log/store.ts       # 问答日志 + 审计日志落库（SQLite）
│   ├── summary/           # 自动问题总结（会话结束/每10轮 → summaries 表）
│   ├── ops/               # /health /metrics admin API
│   ├── web/               # OKF 上传转化的单文件 HTML 页面服务
│   └── config.ts          # YAML+env 合并配置，.env.example 模板
├── scripts/               # Python 脚本库（db_query / ingest_okf / export_xlsx …）
├── kb-okf/                # git 管理的 OKF 知识包
├── workspaces/            # 每用户独立 cwd（.gitignore）
├── data/                  # SQLite + JSONL 备份（.gitignore）
└── deploy/
    ├── bootstrap.js       # 平台检测入口（唯一初始化命令）
    ├── setup.sh           # Linux/macOS：uv+pm2+systemd 可选
    ├── setup.ps1          # Windows：uv+pm2（注意编码，纯 ASCII 输出）
    └── ecosystem.config.js
```

## 4.1 核心表结构（SQLite）

```sql
CREATE TABLE user_sessions (user_id TEXT PRIMARY KEY, session_id TEXT, cwd TEXT, updated_at TEXT);
CREATE TABLE chat_logs (id INTEGER PRIMARY KEY, user_id TEXT, channel TEXT, session_id TEXT, role TEXT, content TEXT, tokens INTEGER, trace_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE summaries (id INTEGER PRIMARY KEY, user_id TEXT, session_id TEXT, category TEXT, summary TEXT, resolved INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE script_audit (id INTEGER PRIMARY KEY, event TEXT, script_name TEXT, old_hash TEXT, new_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);  -- kb.mode 等运行时配置
```

## 4.2 会话池设计（SessionPool）

| 线程池概念 | 对应实现 |
|---|---|
| worker | SDK 会话（CLI 子进程） |
| core/max | 常驻热会话 8 / 最大活跃 20 |
| keepAlive | 空闲 >10min → LRU 淘汰（close 进程，session_id 留库） |
| 任务队列 | 用户请求队列 |
| 拒绝策略 | 冷路径：query({resume}) 单轮一问一答，跑完即退，不占池位 |

acquire(userId) 流程：热命中 → 复用；池有空位 → resume 重建；池满 → 淘汰 LRU 空闲；全忙 → 冷路径。

## 4.3 权限收口（安全设计）

- Agent `allowedTools` 白名单：仅 Read/Grep/Glob + `mcp__scriptlib__*`
- **不给** Bash/Write/Edit——一切执行能力经脚本库，杜绝越权
- canUseTool 回调兜底拦截危险输入；脚本执行统一超时 kill + DB 只读账号
- 管理端口 18790 仅绑定 127.0.0.1

## 5. Code Style（代码风格）

```ts
// ESM + strict；导出命名函数而非默认导出；错误先处理
export async function acquireSession(userId: string): Promise<PoolEntry | null> {
  const entry = pool.get(userId);
  if (entry && entry.state === 'idle') return entry;      // 热命中
  if (pool.size < config.pool.max) return await resumeToPool(userId);
  evictLRU();
  if (pool.size < config.pool.max) return await resumeToPool(userId);
  return null; // → 上层走冷路径（query+resume 单轮）
}
```

命名：文件 kebab-case，类型 PascalCase，常量 SCREAMING_SNAKE。提交信息中文祈使句（`新增 会话池冷路径降级`）。

## 6. Testing Strategy（测试策略）

- 框架 vitest；测试与源码同目录 `*.test.ts`
- 单测重点：session-pool（LRU/冷路径/并发acquire）、queue（用户串行）、runner（超时/编码）、manifest 解析、okf 检索、router 切换
- 集成：CLI 渠道端到端（真 SDK 会话，打桩渠道推送）
- 手工验收：SC1–SC12 逐条对（见 plan.md 各任务验收节）
- 覆盖率：核心模块（pool/queue/runner）行覆盖 ≥80%，渠道适配器打桩测试为主

## 7. Boundaries（边界）

- **Always**：提交前 npm test + lint；新表先迁移脚本；结构化日志带 trace_id
- **Ask first**：加新依赖；改 SDK 调用方式；变更 SQLite schema；改渠道凭证格式
- **Never**：提交任何密钥/Token；提交 data/、workspaces/；删除失败测试跳过覆盖
- 平台注意：Windows 脚本纯 ASCII 输出防乱码；路径一律 path.join；Python 文件强制 UTF-8 头

## 8. Success Criteria 对应实现锚点

| SC | 实现锚点 | 验证方式 |
|---|---|---|
| SC1/2/3 | channels/cli.ts + session-pool.ts | 集成测试 + 手工 |
| SC4 | session-pool 冷路径分支 | 单测 mock 池满 |
| SC5 | log/store.ts | SQL 查询断言 |
| SC6 | kb/router.ts | 单测 + 手工热切换 |
| SC7 | core/agent.ts allowedTools | 集成：请求 Bash 被拒 |
| SC8 | scripts-lib/watcher.ts | 改脚本 → 查 audit 表 + 收到通知 |
| SC9 | web/ + scripts/ingest_okf.py | 上传 docx → kb-okf 出现新 concept |
| SC10 | deploy/bootstrap.js | 两平台各跑一次全新部署 |
| SC11 | summary/ | 会话结束 → summaries 表有记录 |
| SC12 | pm2 + /health | kill -9 后自动重启 |

## 9. Open Questions（待 boos王 拍板）

1. ima 知识库 API 凭据/文档何时提供？（Phase 3 前给出即可，先 stub）
2. 管理员通知渠道：飞书 webhook 还是企微机器人？（默认飞书 webhook）
3. 首发渠道顺序：CLI 调试渠道 → 建议企微（长连接免域名）→ 飞书 → ClawBot → 微信客服，认可？
4. 部署机器规格参考（内存上限决定 pool.max 默认值，默认 20）
5. OKF 知识包初始内容：空包起步还是先灌一批 FAQ？
