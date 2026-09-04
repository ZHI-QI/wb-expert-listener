# wb-expert-listener 部署与运维手册

> 单机轻量服务：接收飞书/企微/微信ClawBot/微信客服消息 → WorkBuddy 会话 → 回答。
> 跨 Linux / Windows；专家初始化一条命令部署。

## 快速部署（SC10）

```bash
git clone <repo-url> wb-expert-listener
cd wb-expert-listener
node deploy/bootstrap.js     # 自动检测平台 → 装依赖 → pm2 守护 → 生成 .env
```

`bootstrap.js` 内部：平台检测（win32 判定）→ npm（npmmirror 镜像）→ uv（清华 PyPI 镜像）→ `.env` 从模板生成 → `pm2 start ecosystem.config.js` + 开机自启注册。

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node | ≥18（推荐 22） | 服务运行时 |
| Python + uv | ≥3.10 / ≥0.5 | 脚本库执行（`UV_INDEX_URL` 已配国内镜像） |
| git | 任意 | 拉取与 OKF 版本化 |
| codebuddy CLI | 已登录 | Agent SDK 凭据（或 API Key env） |

## 日常运维

```bash
pm2 status                       # 进程状态
curl http://127.0.0.1:18790/health    # 组件健康（渠道/KB/池/队列）
curl http://127.0.0.1:18790/metrics   # Prometheus 指标
pm2 logs wb-expert-listener --lines 100

# 升级
git pull && npm run build && pm2 reload wb-expert-listener

# 知识库上传页（本机浏览器）
# http://127.0.0.1:18790/okf
```

## 渠道启用（按 .env 逐个打开）

| 渠道 | 环境变量 | 备注 |
|---|---|---|
| CLI | 默认开 | 终端调试 |
| 飞书 | `WB_FEISHU_APP_ID/SECRET` | 事件回调 `/webhook/feishu` |
| 企微机器人 | `WB_WECOM_BOT_ID/SECRET` | WSS 长连接，免域名 |
| 微信 ClawBot | `WB_CLAWBOT_ENABLED=true` | 依赖本机 OpenClaw 网关（`openclaw gateway start`） |
| 微信客服 | `WB_WECOM_KF_*` | 回调 `/webhook/wechat-kf`，5s 秒回已内置 |

## 故障速查

| 现象 | 排查 |
|---|---|
| 起不来 | `pm2 logs` 看启动错误；检查 `.env` 缺项（启动即报缺失 key） |
| 机器人不回 | `/health` 看 channel 状态；`chat_logs` 表看消息是否到达 |
| 微信客服无回复 | 确认回调 5s 内回 success（日志 timing）；检查 `send_msg` errcode |
| ClawBot 不通 | `openclaw gateway status`；网关未起则渠道自动跳过 |
| 脚本不执行 | `script_audit` 表 + `logs/`；uv 是否安装；超时被 kill 会标注 timeout |

## 安全红线

- 管理端口只绑 `127.0.0.1`，禁止暴露公网
- Agent 会话 allowedTools 白名单（Read/Grep/Glob + 脚本库），永不放开 Bash
- 密钥只放 `.env`（已 gitignore）；泄露立即重置
- 脚本库增删改自动审计 + 管理员通知，不可关闭
