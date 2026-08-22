# Changelog

All notable changes to the **dsh-plugin-cli-hub** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
starting with `1.0.0`; during the `0.x` Developer Preview, breaking changes bump the
**minor** version.

---

## [0.1.0] — 2026-08-22

> First public Developer Preview release. Installable via
> `dsh plugin add github:<YOU>/dsh-plugin-cli-hub` / `dsh plugin add npm:dsh-plugin-cli-hub` /
> `dsh plugin add file:///path`.

### Added

#### 1. 33 built-in AI CLI adapters（5 大类）

**A. 商业云端 AI CLI（10）**
Claude Code, Kimi CLI (Moonshot), Snow CLI (Mistral/Snowflake AI), Gemini CLI,
Groq CLI, OfficeCLI, Qwen CLI (Alibaba Tongyi), Doubao CLI (ByteDance),
GLM CLI (Zhipu), MiniMax CLI.

**B. IDE 内嵌 AI 入口 CLI（6）**
Codex CLI (Trae), Copilot CLI, Windsurf CLI, Cursor CLI, Cline CLI, Devin Desktop CLI.

**C. 本地模型网关 CLI（5）**
Ollama, llama.cpp, LM Studio CLI, Jan CLI, LiteLLM Proxy CLI.

**D. 开源 Agent / Autonomous Coding CLI（8）**
Aider, Continue.dev, OpenHands (原 OpenDevin) CLI, Goose CLI (Block),
Smol Developer, OpenClaudia, Paperclip AI, FreeBuf CLI.

**E. 通用 LLM Chat CLI（4）**
tgpt, aichat (Sigoden), LLM CLI (Simon Willison), Chatblade,
Soul5 CLI, Junie CLI, CatPaw CLI.

#### 2. Scanner — 三层自动发现，覆盖 6 类扫描源

- `L1` 按可执行文件名指纹匹配；`L2` 版本号提取；`L3` 登录态验证。
- 扫描源：`$PATH`、用户常用 bin 目录（~/.local/bin, ~/.cargo/bin, ~/.bun/bin 等）、
  macOS App Bundle `/Applications/*.app/Contents/**/bin`、系统包管理器 bin、
  npm global、Python user scripts。
- 解决 macOS launchd 进程 PATH 被重置导致"扫不到 brew/bin"的经典问题。

#### 3. QuotaManager — 额度查询 + 本地估算

- 四种查询方式：`command` / `http` / `file` / `unknown`（fallback）。
- 每工具调用、每 Agent turn 按估算函数累计 used；TTL + 阈值告警。
- 输出：`source / currency / total / used / remaining / period / refreshedAt / breakdown`。

#### 4. ToolGateway — 所有已发现 CLI 自动注册为 DSH ctx.tools

- **新增 `kind: 'argv'` 安全命令映射**（推荐），按数组传参数，天然避免引号/空格注入；
  同时保留 `kind: 'template'` 向后兼容（日志 DEPRECATE 警告，v0.2.0 移除）。
- 对所有渲染路径做 `NUL 字节 × 100,000 字符上限` 安全断言。
- Sandbox strict / relaxed 两级；连续 N 次失败 → failureCooldown 强制冷却。
- 调用历史落地 + 事件总线 `tool-called / tool-succeeded / tool-failed`。

#### 5. AgentGateway — 5 种协议 spawn 独立子 Agent

- `acp / mcp-stdio / stdio-jsonrpc / line-based / stream-json`。
- `readyPattern` 等待 ready banner，graceful shutdown（SIGINT/SIGTERM + grace ms）。
- 每个 adapter 一个 singleton（默认）。Agent 元数据：displayName / avatarEmoji /
  strengths / shareDshTools。

#### 6. Web UI — 6 Section + SSE + 12 HTTP endpoints

- 概览 / 已发现 CLI / Adapter 开关 / 额度监控 / 工具列表 / Agent 会话管理。
- SSE 事件流用于推送扫描进度、额度变更、调用历史。
- 挂载路径：DSH settings 卡片、独立 `/cli-hub` 路由、REST `/api/cli-hub/v1/*`。

#### 7. DSH CLI 子命令

```bash
dsh cli-hub scan [l1|l2|l3]    # 触发扫描
dsh cli-hub list               # 列出 adapter / 开关
dsh cli-hub enable <id> | disable <id>
dsh cli-hub quota [--adapter <id>]
dsh cli-hub tool exec <toolName> '<json>'
dsh cli-hub agent start <id> | stop <id> | list
```

#### 8. 脚本

- `scripts/show-quota.mjs` — 不依赖 DSH，独立扫描 + 输出额度状态（带颜色）。
- `scripts/e2e-smoke.mjs` / `smoke-claude-agent.mjs` — 端到端冒烟。
- `scripts/install-to-dsh-web.sh` — 一键把本插件塞进本机 `~/.dsh/profiles/web`。
- `scripts/release-smoke-install.sh` — 发布前 file/GitHub/npm 三通道安装验证。

#### 9. 文档 / 发布元数据

- README（中文）v0.1.0 重写，含 6 大 feature + 33 适配器表 + 架构 + FAQ + Roadmap。
- package.json 补齐 `repository / homepage / bugs / exports.default / files / keywords`。
- `LICENSE`（MIT）+ `THIRD_PARTY_NOTICES.md`（30+ 厂商商标免责）。
- CHANGELOG / CONTRIBUTING / RELEASE-PLAN / RELEASING 发布清单。

### Testing

- 54 个 vitest 单测（含 Scanner 6 类扫描源、QuotaManager、ToolGateway 安全、
  AgentGateway 5 协议、Adapter 注册校验），均通过。
- `pnpm typecheck` 0 errors。
- Gateway argv 安全单测：双引号/分号注入、含空格路径、pair 跳过、NUL + 超长拒绝。

### Known Issues（本版本存在、v0.2.0 计划修复）

1. **27/33 个 adapter 的 Tool 模式仍在使用 `kind: 'template'`**：已经在 types.ts 标记
   DEPRECATE，v0.2.0 全部迁移到 `kind: 'argv'`（核心 6 个已迁移）。
2. **Quota 查询覆盖率**：33 个 adapter 中仅 Claude Code、Snow CLI、Kimi、OfficeCLI、
   Gemini CLI 配了真实 provider 查询；其余走 estimate 累计（estimatePerToolCall /
   estimatePerAgentTurn）或 `unknown`。
3. **Agent 端到端验证**：目前只有 claude-code / snow-cli 两个 Agent 模式经过真环境
   spawn + send + recv + shutdown 验证；其余 9 个声明了 agent 能力的 adapter 按协议
   写了 spawn argsTemplate，但未做真人环境验证。
4. **平台支持**：macOS (arm64 + x64) 验证过；Linux 理论兼容（依赖 POSIX execFile 和
   ~/.config 路径），未经 CI 实跑；Windows 不在 v0.1.0 支持范围内。
5. **npm package name 冲突风险**：当前 name=`dsh-plugin-cli-hub`。若 `pnpm publish`
   报告 403 name taken，立刻改 scoped：`@<gh-user>/dsh-plugin-cli-hub`，同时同步
   README 安装命令、package.json `files` 和 cordis.patch.yml `name`。

---

## [0.1.0-rc.1] — UNRELEASED（Pre-release internal）

All changes above were developed internally and consolidated as `v0.1.0` for the first
public release. No prior public version was published.
