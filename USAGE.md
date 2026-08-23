# Usage Guide

> **Language / 语言**: English first · [简体中文在下方](#使用说明中文)

This is the hands-on, copy-paste-friendly guide to actually *using* dsh-plugin-cli-hub inside DSH.
For architecture and the full adapter catalog, see [README.en.md](./README.en.md).

---

## What you get (30 seconds)

Once installed, the plugin:

1. **Auto-scans your machine** for installed AI CLIs (Claude Code, Codex, Gemini CLI, Ollama, Snow CLI, …33 built-in fingerprints).
2. Exposes discovered + logged-in CLIs to your DSH Agent as:
   - **Tools** (`cli-hub:<adapter>:run-task`) — one-shot tasks executed through the CLI;
   - **Agents** (`spawn` long-lived subprocesses, e.g. Claude Code over stream-json).
3. Tracks **quota** usage per adapter (provider query when available, estimation otherwise).
4. Ships a **Web UI** at `http://127.0.0.1:3080/cli-hub` plus REST APIs and `dsh cli-hub …` terminal commands.

You never re-enter API keys — the plugin just reuses the CLIs you are already logged into.

---

## Step 0 · Prerequisites

Run each check; fix what fails before moving on.

```bash
node -v          # need >= 18.18
dsh --version    # need >= 0.1.0-rc.8  (DSH itself must be installed)
git --version    # only if installing from a git clone
```

Have **at least one AI CLI installed and logged in**, e.g.:

```bash
npm i -g @anthropic-ai/claude-code && claude auth login   # example: Claude Code
ollama pull llama3.1                                      # example: Ollama (no login needed)
```

Not sure what you have? The plugin will tell you in Step 2 — that is its job.

---

## Step 1 · Install the plugin

Pick **one** of the three ways.

### Way A — one-shot script (recommended while developing this repo)

```bash
bash /path/to/dsh-cli/scripts/install-to-dsh-web.sh
```

The script builds the plugin, installs it into the DSH `web` profile (`~/.dsh/profiles/web`),
registers it in `dsh.profile.bundles`, restarts DSH and prints diagnostic commands.

### Way B — plain `dsh plugin add`

```bash
# from a local checkout
dsh plugin --profile web add file:///path/to/dsh-cli

# or from GitHub / npm once published
dsh plugin --profile web add github:<you>/dsh-plugin-cli-hub
dsh plugin --profile web add npm:dsh-plugin-cli-hub
```

Then restart DSH (Step 2) yourself.

### Way C — isolated test profile (recommended for experiments)

```bash
dsh plugin --profile cli-hub-test add file:///path/to/dsh-cli
# later run everything with: dsh --profile cli-hub-test web ...
```

Keeps your daily `web` profile untouched.

---

## Step 2 · Start DSH and verify the plugin loaded

```bash
pkill -f "dsh web" 2>/dev/null; sleep 1
cd ~/.dsh/profiles/web && nohup npx dsh web > /tmp/dsh-web.log 2>&1 &
sleep 6
grep -E 'cli-hub|ERROR' /tmp/dsh-web.log | head -20
```

✅ Success looks like:

```
[cli-hub] loaded. adapter count=33 / initial L1 scan done. items=…
```

Quick smoke check from the terminal:

```bash
dsh --profile web cli-hub list        # lists all 33 adapters
dsh --profile web cli-hub scan l3     # real L3 scan; expect several hits on a dev machine
```

If `scan l3` finds nothing, jump straight to [Troubleshooting](#step-5--troubleshooting).

---

## Step 3 · Use it — three ways

### Way A — talk to your DSH Agent (zero learning curve)

Open the DSH chat and just ask in natural language:

| Say | What happens |
|---|---|
| “Scan the AI CLIs installed on this machine” | Agent calls `ctx.cliHub.scan('l3')`, returns the discovery table |
| “Use local Claude Code to write a script that adds eslint-disable to all .ts files in this dir” | Agent triggers tool `cli-hub:claude-code:run-task`; runs via your Claude subscription |
| “How much quota is left on my CLIs?” | Agent reads quota rows via the quota service |
| “Start a claude-code agent session” | AgentGateway spawns Claude Code as a long-lived sub-agent |

No configuration needed — discovered + authenticated adapters are registered as tools automatically.

### Way B — terminal commands (debugging / scripting)

```bash
dsh cli-hub scan l3                      # deep scan (fingerprint + version + auth)
dsh cli-hub list                         # all adapters + enabled/discovered state
dsh cli-hub enable snow-cli              # force-enable an adapter
dsh cli-hub disable kimi-cli             # disable one
dsh cli-hub quota                        # quota table for enabled adapters
dsh cli-hub quota claude-code            # single adapter

# run one tool directly (argv-safe execution):
dsh cli-hub tool exec 'cli-hub:echo-smoke:say' '{"message":"hello"}'

# agent lifecycle (adapters that declare an agent capability):
dsh cli-hub agent spawn claude-code      # start long-lived session
dsh cli-hub agent list                   # active sessions
dsh cli-hub agent status claude-code     # pid/status/uptime
dsh cli-hub agent send claude-code 'hi'  # one message -> one reply (protocol debug)
dsh cli-hub agent stop claude-code       # graceful shutdown
```

> Tip: `tool exec` needs the tool to be registered first — run a scan, and make sure the
> adapter is both **discovered** and **enabled** (`dsh cli-hub list` shows both flags).

### Way C — Web UI (visual control panel)

Open **<http://127.0.0.1:3080/cli-hub>** (or DSH → Settings → scroll to the “CLI Hub” card).

| Section | What you can do |
|---|---|
| Overview | Scan summary; trigger quick L1 rescan / refresh all quotas |
| Discovered AI CLIs | Per-CLI toggle switch, install hint for missing ones |
| Adapter toggles | Enable/disable any of the 33 built-ins |
| Quota monitoring | used/total/percent per adapter, manual refresh |
| Available tools | Every registrable tool + its input schema |
| Agent sessions | Live subprocess table: stop one / stop all |

Everything clickable maps to a `ui-action`, so what you click here is exactly what the
Agent can do in chat.

### Bonus — HTTP API (for scripts / external dashboards)

```bash
BASE=http://127.0.0.1:3080/cli-hub/api

curl -s $BASE/dashboard | python3 -m json.tool           # summary snapshot
curl -s "$BASE/scan?depth=l3" | python3 -m json.tool     # run a scan
curl -s $BASE/quota | python3 -m json.tool               # quota rows

# toggle an adapter
curl -s -X POST $BASE/action -H 'Content-Type: application/json' \
  -d '{"id":"toggle-adapter","payload":{"adapterId":"snow-cli","enabled":true}}'

# execute a tool
curl -s -X POST $BASE/tools/exec -H 'Content-Type: application/json' \
  -d '{"toolName":"cli-hub:snow-cli:draw","input":{"prompt":"a cute corgi"}}'

# live events (SSE)
curl -N $BASE/events
```

---

## Step 4 · Everyday workflow

```
install once (Step 1)
   └─> DSH auto-scans every boot (+ every 30 min in background)
         └─> new CLI installed & logged in?  -> it appears automatically
               └─> use it from chat / web UI / CLI
                     └─> watch quotas in the Quota section
```

Nothing to do day-to-day. Typical touch points:

- **New CLI installed** → wait for the background rescan or say “rescan” in chat / `dsh cli-hub scan l2`.
- **Adapter misbehaving** → disable it in the Web UI or `dsh cli-hub disable <id>`.
- **Quota warning** (`quota-warning` event at ≤10% remaining) → shown in Web UI + SSE feed.

---

## Step 5 · Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Log shows `spawn claude ENOENT` | macOS launchd resets PATH for background processes | Built-in extended-PATH already covers common dirs; for custom locations add `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"` to `~/.dsh/profiles/web/env.sh` |
| `scan` finds 0 CLIs | binaries not under scanned dirs | Run `which <cmd>`; if the path is exotic, override `spawn.command` via cordis.patch.yml `adapters.custom` |
| `authState = unknown` everywhere | authCheck regex mismatch for that CLI | File an issue with `<cmd> auth status` output; meanwhile the Tool may still work — try it |
| `dsh cli-hub tool exec` says tool not found | adapter not discovered or not enabled | `dsh cli-hub list` → check both flags; enable + rescan |
| Agent spawn times out | readyPattern mismatch after a CLI update | Override `readyPattern` via cordis.patch.yml `adapters.custom.<id>.agent.spawn` |
| Credentials read error mentioning `version` | DSH credentials.yaml has `version: "1"` (string) | It must be a number: `version: 1` without quotes |
| Repeated failures then everything blocked | failure cooldown engaged (by design) | Wait `failureCooldownSec` (default 30s) or fix the underlying cause |

Still stuck? Open a GitHub Issue with the output of:

```bash
grep -E '(cli-hub|ERROR|WARN)' ~/.dsh/profiles/web/*.log | tail -50
```

---

## Step 6 · Update / uninstall

```bash
# update (local checkout)
cd /path/to/dsh-cli && git pull && bash scripts/install-to-dsh-web.sh

# uninstall
(cd ~/.dsh/profiles/web && pnpm remove dsh-plugin-cli-hub)
# then remove the package name from package.json -> dsh.profile.bundles
pkill -f "dsh web"; cd ~/.dsh/profiles/web && nohup npx dsh web > /tmp/dsh-web.log 2>&1 &
```

---
---

# 使用说明（中文）

这是真正能跑起来的手把手指南，全部命令可复制粘贴。架构说明与 33 个 adapter 完整清单见 [README.md](./README.md)。

---

## 这个插件能干什么（30 秒）

装好之后它会：

1. **自动扫描本机**已安装的 AI CLI（Claude Code、Codex、Gemini CLI、Ollama、Snow CLI……内置 33 个指纹）。
2. 把「已发现且已登录」的 CLI 接入你的 DSH Agent：
   - **Tool 模式**（`cli-hub:<adapter>:run-task`）——一次性任务，走对应 CLI 执行；
   - **Agent 模式**——spawn 长生命周期子进程（例如 Claude Code 的 stream-json 协议）。
3. 跟踪每个 adapter 的**额度**（支持 provider 实时查询的走查询，否则本地估算）。
4. 自带 **Web UI**（`http://127.0.0.1:3080/cli-hub`）、REST API 和 `dsh cli-hub …` 终端命令。

全程不需要再填任何 API Key——它复用的就是你本机已经登录好的那些 CLI。

---

## 第 0 步 · 前置检查

逐条运行，哪个不过先修哪个：

```bash
node -v          # 需要 >= 18.18
dsh --version    # 需要 >= 0.1.0-rc.8（DSH 本体要先装好）
```

并且**至少有一个 AI CLI 已安装且登录**，例如：

```bash
npm i -g @anthropic-ai/claude-code && claude auth login   # 例：Claude Code
ollama pull llama3.1                                      # 例：Ollama（无需登录）
```

不确定自己有什么？不用管，第 2 步扫描会告诉你——这正是插件的工作。

---

## 第 1 步 · 安装插件

三选一。

### 方式 A —— 一键脚本（开发本仓库时最省事）

```bash
bash /path/to/dsh-cli/scripts/install-to-dsh-web.sh
```

脚本会自动：构建插件 → 装进 DSH `web` profile（`~/.dsh/profiles/web`）→ 写入
`dsh.profile.bundles` → 重启 DSH → 打印诊断命令。

### 方式 B —— 标准 `dsh plugin add`

```bash
# 本地源码路径
dsh plugin --profile web add file:///path/to/dsh-cli

# 或发布后的 GitHub / npm
dsh plugin --profile web add github:<you>/dsh-plugin-cli-hub
dsh plugin --profile web add npm:dsh-plugin-cli-hub
```

装完自己执行第 2 步重启。

### 方式 C —— 隔离测试 profile（推荐折腾时用）

```bash
dsh plugin --profile cli-hub-test add file:///path/to/dsh-cli
# 之后所有命令加 --profile cli-hub-test，不污染日常 web profile
```

---

## 第 2 步 · 启动 DSH 并确认插件加载成功

```bash
pkill -f "dsh web" 2>/dev/null; sleep 1
cd ~/.dsh/profiles/web && nohup npx dsh web > /tmp/dsh-web.log 2>&1 &
sleep 6
grep -E 'cli-hub|ERROR' /tmp/dsh-web.log | head -20
```

✅ 成功标志：

```
[cli-hub] loaded. adapter count=33 / initial L1 scan done. items=…
```

终端快速冒烟：

```bash
dsh --profile web cli-hub list        # 列出全部 33 个 adapter
dsh --profile web cli-hub scan l3     # 真 L3 扫描，开发机上应有多个命中
```

如果 `scan l3` 一个都扫不到，直接跳到[排错](#第-5--步--常见问题排查)。

---

## 第 3 步 · 用起来 —— 三种方式

### 方式 A —— 直接和 DSH 对话（零学习成本）

打开 DSH 聊天框，自然语言直说：

| 你说 | 会发生什么 |
|---|---|
| 「扫描一下本机装了哪些 AI CLI」 | Agent 调 `ctx.cliHub.scan('l3')`，返回发现表格 |
| 「用本机 Claude Code 帮我写一个给目录里所有 .ts 文件批量加 eslint-disable 的脚本」 | Agent 触发工具 `cli-hub:claude-code:run-task`，用你的 Claude 订阅执行 |
| 「看看我各个 CLI 还剩多少额度」 | Agent 通过额度服务读取并汇总 |
| 「给我起一个 claude-code 的 agent 会话」 | AgentGateway 将 Claude Code 作为长驻子 Agent 拉起 |

无需任何配置——已发现且已认证的 adapter 会自动注册成工具。

### 方式 B —— 终端命令（调试 / 脚本化）

```bash
dsh cli-hub scan l3                      # 深度扫描（指纹+版本+登录态）
dsh cli-hub list                         # 全部 adapter 与启用/发现状态
dsh cli-hub enable snow-cli              # 强制启用某个
dsh cli-hub disable kimi-cli             # 禁用某个
dsh cli-hub quota                        # 已启用 adapter 的额度表
dsh cli-hub quota claude-code            # 单个查询

# 直接执行一个工具（argv 安全执行）：
dsh cli-hub tool exec 'cli-hub:echo-smoke:say' '{"message":"hello"}'

# agent 生命周期（声明了 agent 能力的 adapter）：
dsh cli-hub agent spawn claude-code      # 启动长驻会话
dsh cli-hub agent list                   # 当前会话列表
dsh cli-hub agent status claude-code     # pid/状态/时长
dsh cli-hub agent send claude-code 'hi'  # 发一条收一条（协议调试）
dsh cli-hub agent stop claude-code       # 优雅关闭
```

> 提示：`tool exec` 要求工具已注册——先扫一次描，并确认该 adapter 同时满足
> **已发现 + 已启用**（`dsh cli-hub list` 里两个状态都能看到）。

### 方式 C —— Web UI（可视化管理面板）

浏览器打开 **<http://127.0.0.1:3080/cli-hub>**（或 DSH → 设置 → 「CLI Hub」卡片）。

| 分区 | 能做什么 |
|---|---|
| 概览 | 扫描汇总；触发快速 L1 重扫 / 全量刷新额度 |
| 已发现的 AI CLI | 每个 CLI 一键开关；未安装的显示安装提示 |
| Adapter 开关 | 33 个内置 adapter 全部可启停 |
| 额度监控 | used/total/百分比，手动刷新 |
| 可用工具 | 所有可注册工具及其输入 schema |
| Agent 会话 | 存活子进程表：单个停止 / 全部停止 |

界面上每个按钮都对应一个 `ui-action`——你在界面里点的，就是 Agent 在对话里能做的。

### 加餐 —— HTTP API（给脚本 / 外部面板用）

```bash
BASE=http://127.0.0.1:3080/cli-hub/api

curl -s $BASE/dashboard | python3 -m json.tool           # 总览快照
curl -s "$BASE/scan?depth=l3" | python3 -m json.tool     # 触发扫描
curl -s $BASE/quota | python3 -m json.tool               # 额度行

# 开关 adapter
curl -s -X POST $BASE/action -H 'Content-Type: application/json' \
  -d '{"id":"toggle-adapter","payload":{"adapterId":"snow-cli","enabled":true}}'

# 执行一个工具
curl -s -X POST $BASE/tools/exec -H 'Content-Type: application/json' \
  -d '{"toolName":"cli-hub:snow-cli:draw","input":{"prompt":"a cute corgi"}}'

# 实时事件流（SSE）
curl -N $BASE/events
```

---

## 第 4 步 · 日常使用节奏

```
装一次（第 1 步）
   └─> DSH 每次启动自动扫描（后台每 30 分钟刷新一次）
         └─> 新装了 CLI 并登录？  -> 自动出现，无需操作
               └─> 在聊天 / Web UI / 终端随便哪种方式用
                     └─> 额度监控分区随时看余量
```

平时基本零维护。常见触点：

- **新装了一个 CLI** → 等后台重扫，或对话里说「重新扫描」，或 `dsh cli-hub scan l2`。
- **某个 adapter 不正常** → Web UI 里关掉，或 `dsh cli-hub disable <id>`。
- **额度告警**（剩 ≤10% 时触发 `quota-warning` 事件）→ Web UI 和 SSE 流都会提示。

---

## 第 5 步 · 常见问题排查

| 现象 | 原因 | 解法 |
|---|---|---|
| 日志出现 `spawn claude ENOENT` | macOS launchd 会重置后台进程 PATH | 插件已内置扩展 PATH 覆盖常见目录；特殊位置请在 `~/.dsh/profiles/web/env.sh` 里 `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"` |
| `scan` 扫到 0 个 | 可执行文件不在被扫目录 | 先 `which <cmd>`；路径太偏可用 cordis.patch.yml 的 `adapters.custom` 覆盖 `spawn.command` |
| 所有 adapter `authState = unknown` | 该 CLI 的 authCheck 正则没匹配上 | 带着 `<cmd> auth status` 输出来提 Issue；期间 Tool 可能照样能用，试一下 |
| `tool exec` 说找不到工具 | adapter 未发现或未启用 | `dsh cli-hub list` 核对两个状态位；启用后重扫 |
| Agent spawn 超时 | CLI 升级后 readyPattern 不匹配 | 用 cordis.patch.yml 的 `adapters.custom.<id>.agent.spawn.readyPattern` 覆盖 |
| 报错提到 credentials `version` 字段 | DSH credentials.yaml 写成了 `version: "1"`（字符串） | 必须是数字：`version: 1`，不要引号 |
| 连续失败后所有调用被拒 | 失败冷却机制生效（设计如此） | 等 `failureCooldownSec`（默认 30 秒），或先修好底层原因 |

还不行？带上下面的输出来开 GitHub Issue：

```bash
grep -E '(cli-hub|ERROR|WARN)' ~/.dsh/profiles/web/*.log | tail -50
```

---

## 第 6 步 · 更新与卸载

```bash
# 更新（本地源码方式）
cd /path/to/dsh-cli && git pull && bash scripts/install-to-dsh-web.sh

# 卸载
(cd ~/.dsh/profiles/web && pnpm remove dsh-plugin-cli-hub)
# 再从 package.json 的 dsh.profile.bundles 数组里删掉包名
pkill -f "dsh web"; cd ~/.dsh/profiles/web && nohup npx dsh web > /tmp/dsh-web.log 2>&1 &
```
