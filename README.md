# dsh-plugin-cli-hub

> **DeepSeek Harness (DSH) 插件**：自动扫描本机已安装的各种 AI CLI 工具，把它们已经订阅的额度统一接入 DSH，作为 **Tool 模式** 和 **Agent 模式** 两种能力暴露给 DSH Agent 复用，免去重复申请 API Key、重复购买额度的麻烦。

- DSH profile：`web`
- 主入口：`dist/index.cjs` / `dist/index.js`
- 包名：`dsh-plugin-cli-hub`
- License：MIT

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [支持的 AI CLI](#支持的-ai-cli)
- [架构设计](#架构设计)
- [HTTP API](#http-api)
- [Web UI 使用指南](#web-ui-使用指南)
- [配置说明](#配置说明)
- [开发指南](#开发指南)
- [常见问题](#常见问题)
- [License](#license)

---

## 特性

- **自动扫描本机 AI CLI**：三层扫描（L1 文件名 / L2 版本号 / L3 登录态），无需手写配置；首次启动 20ms 出结果，后台 30 分钟刷新一次。
- **Tool 模式复用订阅额度**：把已发现且已认证的 CLI 命令注册成 DSH `ctx.tools` 工具，由 DSH Agent 在对话中按自然语言触发，模板渲染 + 严格沙箱执行（`execFile` 语义，不经 shell）。
- **Agent 模式长期子进程**：把 CLI 作为 `spawn` 出来的长期子 Agent 复用订阅额度，支持 `stdio-jsonrpc` / `stream-json` / `line-based` / `mcp-stdio` 多协议；DSH 退出时三阶段 graceful shutdown（SIGINT → grace → SIGTERM → SIGKILL）杜绝孤儿进程。
- **额度监控**：支持 `command` / `http` / `file` / `unknown` 四种 provider 查询方式 + 本地估算累计 + TTL 缓存 + 阈值告警（剩 10% 触发 `quota-warning`，归零触发 `quota-depleted`）。
- **21+ adapter 设计容量**：内置 4 款开箱即用（claude-code / snow-cli / kimi-cli / officecli），剩余 17 款（codex、gemini-cli、aider、cline、continue、opencode、goose、cursor-cli、junie、windsurf、aichat、tgpt、ollama、litellm、grok、qwen、trae）走 `defineCliAdapter(...)` 自定义扩展路径。
- **交互式 Web UI**：DSH 设置页卡片、独立 `/cli-hub` 路由页、`/cli-hub/api/*` REST 端点三路并存；Dashboard 汇总 + Adapter 列表/详情 + 额度监控 + 工具列表 + Agent 会话表，全部可点按钮触发后端动作。
- **DSH CLI 子命令**：`dsh cli-hub scan|list|enable|disable|quota|tool exec|agent spawn|list|status|stop|send`，可在终端调试。
- **平台健壮性**：自动补全 macOS launchd 后台进程被重置的 PATH（详见 [常见问题](#常见问题)），所有 `ctx.*` 读取走 `safeGet` 多路径兜底，DSH/Cordis rc 版本兼容。

---

## 快速开始

### 前置要求

- Node.js `>=18.18`
- DSH `>=0.1.0-rc.8`（提供 `webServer` / `subprocess` / `storage` / `tools` 等 service）
- 至少一款本机已登录的 AI CLI（如 `npm i -g @anthropic-ai/claude-code && claude auth login`）

### 1) 安装到 DSH web profile

```bash
# 方法 A：官方 dsh plugin 命令（从 npm registry 安装）
dsh plugin --profile web add dsh-plugin-cli-hub

# 方法 B：本地开发路径链接
dsh plugin --profile web add file:///Users/wf/自进化/临时/dsh-cli

# 方法 C：手动脚本（最稳，等价于 B，自动 build + 写 bundles + 重启 DSH）
bash /Users/wf/自进化/临时/dsh-cli/scripts/install-to-dsh-web.sh
```

### 2) 重启 DSH

```bash
pkill -f "dsh web"
sleep 1
nohup dsh web > /tmp/dsh-web.log 2>&1 &
```

### 3) 验证加载

```bash
# 看日志
grep -E 'cli-hub|loaded' /tmp/dsh-web.log | head -20
# 期望：[cli-hub] loaded. adapter count=4 / initial L1 scan done. items=...

# 浏览器打开
open http://127.0.0.1:3080/
# DSH → 设置 → 插件列表 → 出现 dsh-plugin-cli-hub
```

### 4) 首轮扫描 + 触发第一条 Tool 消息

在 DSH 对话里直接说：

> 列出本机已安装的 AI CLI 和它们的订阅额度

DSH Agent 会自动调用 `ctx.cliHub.scan('l3')` → 返回扫描表。

接着试用 Tool 模式：

> 用本机 Claude Code 帮我写一个把目录里所有 .ts 文件批量加 eslint-disable 的脚本

DSH 会自动触发 `cli-hub:claude-code:run-task` 工具，复用本机 Claude 订阅执行。

---

## 支持的 AI CLI

内置 adapter（开箱即用，定义在 `src/adapters/builtin/`）：

| 名称 | adapter id | vendor | 命令 | Tool 模式 | Agent 模式 |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | Anthropic | `claude` | 任意任务 (`run-task`) | stream-json (首批) |
| Snow CLI | `snow-cli` | Snowflake AI | `snow` | 画图 / 翻译 / TTS / ASR | line-based REPL |
| Kimi CLI | `kimi-cli` | Moonshot AI | `kimi` | 联网搜索 + 长文档阅读 | stdio-jsonrpc (占位) |
| OfficeCLI | `officecli` | iOfficeAI | `officecli` | 生成 PPT / DOCX / XLSX | (纯 Tool) |

社区/计划支持的 adapter（通过 `defineCliAdapter(...)` 自定义即可接入，指纹需按各 CLI 实际命令补全）：

| 名称 | 建议命令 | vendor | 能力备注 |
|---|---|---|---|
| Codex | `codex` | OpenAI | 代码补全/Agent |
| Gemini CLI | `gemini` | Google | 多模态 |
| Aider | `aider` | open source | pair-programming |
| Cline | `cline` | open source | IDE Agent |
| Continue | `continue` | Continue Dev | IDE 补全 |
| OpenCode | `opencode` | open source | terminal Agent |
| Goose | `goose` | Block | MCP Agent |
| Cursor CLI | `cursor-cli` | Cursor | 代码 Agent |
| Junie | `junie` | JetBrains | IDE Agent |
| Windsurf | `windsurf` | Codeium | IDE Agent |
| AIChat | `aichat` | open source | 多 provider 终端 |
| tgpt | `tgpt` | open source | 终端 LLM |
| Ollama | `ollama` | Ollama | 本地模型 |
| LiteLLM | `litellm` | BerriAI | 代理网关 |
| Grok CLI | `grok` | xAI | 推理 |
| Qwen CLI | `qwen` | Alibaba | 通义千问 |
| Trae | `trae` | ByteDance | Trae CLI |
| Snow (legacy) | `snow-cli` | (见内置) | (见内置) |

完整清单及 21+ 总数 = 4 内置 + 17 社区/计划。

### 自定义一个 Adapter

30 秒模板：

```ts
import { defineCliAdapter } from 'dsh-plugin-cli-hub';

export const myCli = defineCliAdapter({
  id: 'my-cool-cli',
  name: 'My Cool CLI',
  description: 'xxxx',
  fingerprint: {
    commandNames: ['mycool', 'mc'],
    versionArgs: ['--version'],
    versionPattern: /mycool\s+v?([\d.]+)/,
    configPaths: ['~/.config/mycool'],
    envVars: ['MYCOOL_API_KEY'],
    authCheck: { cmd: 'mycool auth status', expectAuthenticated: /valid/i },
  },
  quota: {
    method: { kind: 'http', url: 'https://api.mycool.ai/me/usage', field: 'remaining' },
    unit: 'credits',
    refreshIntervalSec: 180,
    totalEstimate: 500,
  },
  capabilities: {
    tools: [{
      dshToolName: 'cli-hub:mycool:run',
      description: '运行 MyCool',
      inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
      commandMapping: { kind: 'template', template: 'mycool run {{q}} --json' },
      outputParser: 'stdout-json',
    }],
    agent: {
      protocol: 'line-based',
      spawn: { command: 'mycool', args: ['--repl'], readyPattern: 'mycool> ', exitCmd: '/quit', env: {} },
    },
  },
  healthProbe: null,
});
```

然后在 DSH 启动 patch 里注册：

```ts
// 在某个 hook 插件 apply 里：
ctx.cliHub.registry.register(myCli);
```

或通过 `cordis.patch.yml` 注入 hook：

```yaml
- insert: [{ id: 'mycool-adapter-hook', name: 'your-pkg/hook' }]
```

---

## 架构设计

整体围绕 5 个核心服务（全部挂在 `ctx.cliHub` 上）：

```
ctx.cliHub
├── registry    Adapter 注册表（内存 Map<id, {def, enabled}>）
├── scanner     本机 CLI 三层自动发现
├── quota       额度查询 / 缓存 / 估算 / 告警
├── tools       ToolGateway → 把 CLI 注册成 ctx.tools 工具
└── agents      AgentGateway → 长生命周期子进程管理
```

### Scanner（L1/L2/L3 三层扫描）

定义在 `src/core/scanner.ts`。

| 层级 | 耗时 | 行为 |
|---|---|---|
| **L1** | ~20ms | 枚举 `$PATH` 下的可执行文件名，按 `fingerprint.commandNames` 做大小写不敏感 match；不启动任何子进程。 |
| **L2** | ~200ms/命中 | 对 L1 命中的每个候选执行 `cmd --version`，用 `versionPattern` 正则解析版本号。 |
| **L3** | ~300ms/命中 | 探测登录态：先查 `envVars`，再查 `configPaths`（弱证据），最后跑 `authCheck.cmd` 并匹配 stdout。 |

扫描过程发事件：`scan-started` / `cli-detected` / `scan-progress` / `scan-done`，转发为 DSH 事件 `cli-hub/cli-detected` / `cli-hub/scan-progress`，支持 `watchScan()` 流式消费。

### Registry

定义在 `src/core/registry.ts`，纯内存对象，零副作用。

- `register(def)` / `unregister(id)`：注册时做轻量校验（id 格式 / name / description / fingerprint / capabilities 必填项）。
- `get(id)` / `listAdapters({ onlyEnabled?, mode?, keyword? })`：查询。
- `setEnabled(id, enabled)` / `isEnabled(id)`：启停；触发 `adapter-enabled-changed` 事件。
- 启动时 `loadBuiltinAdapters(registry)` 加载内置 4 款。

### QuotaManager

定义在 `src/core/quota.ts`。

- 4 种 `method`：`command`（执行子命令拿 JSON / 文本）、`http`（带可选 `authHeader` 拉远端接口）、`file`（读本地凭证文件）、`unknown`（仅估算）。
- 缓存 TTL = `max(quota.refreshIntervalSec, config.cacheTtlSec)`，去重并发请求（同一 adapterId 在 inflight Promise 期间复用）。
- 本地估算：`estimatePerToolCall(toolName, input, output)` / `estimatePerAgentTurn(inTokens, outTokens)` 累计到 `used`。
- 阈值告警：默认剩 10% 触发 `quota-warning`，归零触发 `quota-depleted`，10 分钟节流避免刷屏。

### ToolGateway

定义在 `src/core/gateway-tool.ts`，负责把已发现且已启用的 adapter 注册成 DSH `ctx.tools` 工具。

- `syncRegistrations(scanItems)`：扫描完成后调用，按 adapter 能力声明动态注册 / 注销。
- 每次调用走三阶段：pre-execute（adapter.enabled 检查 + 额度预扣 + 冷却判断）→ execute（模板渲染 + `execFile` 严格沙箱执行）→ post-execute（额度记录 + 历史落盘 + 事件）。
- 安全要点：
  - `sandboxLevel: strict`（默认）= `execFile(cmd, [args])`，**不经过 shell**，没有 `$()` / `&&` / `|` 注入风险。
  - `relaxed` = 允许工作目录自由读写。
  - 连续 `failureCooldownCount` 次失败 → 冷却 `failureCooldownSec` 秒，防止打爆额度。

### AgentGateway

定义在 `src/core/gateway-agent.ts`，长生命周期子进程管理 + 协议适配。

- `spawn(adapterId, opts)`：启动子进程，按 adapter 级别单例（`singletonPerAdapter: true`）默认复用；返回 `AgentSession`。
- `AgentSession` 协议统一 API：
  - `send(msg)` / `recv(timeoutMs?)` / `request(method, params, timeoutMs?)`（jsonrpc 一次性 RPC）
  - `waitReady(timeoutMs?)`：按 `readyPattern` 行匹配，不用 `indexOf` 防半包
  - `shutdown()`：三阶段 `SIGINT → graceMs → SIGTERM → 2s → SIGKILL`
- 支持协议：`stdio-jsonrpc` / `stream-json`（Claude Code v2.1.x 真实协议） / `line-based`（Snow REPL）/ `mcp-stdio` / `acp`。
- 事件：`agent-spawned` / `agent-ready` / `agent-shutdown` / `agent-error`，转发为 `cli-hub/agent-*`。
- DSH dispose 钩子：`stopAll()` 防孤儿进程。

---

## HTTP API

所有端点同时挂在 `/cli-hub/api/*` 和 `/plugins/cli-hub/api/*` 两条前缀下（兼容 DSH 不同路由约定）。响应统一 JSON。

### GET 端点

| 路径 | 说明 | 关键 query |
|---|---|---|
| `GET /cli-hub/api/dashboard` | Dashboard 汇总（扫描时间 / 总数 / 已匹配 / 已启用 / 已认证 / 会话数） | — |
| `GET /cli-hub/api/adapters` | Adapter 列表（带 enabled / discovered / auth 状态） | — |
| `GET /cli-hub/api/adapters/:id` | 单个 adapter 详情（fingerprint / capabilities / quota / scanInfo） | — |
| `GET /cli-hub/api/scan` | 触发一次扫描并返回 ScannerRow[] | `depth` = `l1` / `l2` / `l3`、`timeoutPerCmd` |
| `GET /cli-hub/api/quota` | 全部已启用 adapter 的额度行 | — |
| `GET /cli-hub/api/tools` | 已发现且已认证 adapter 的工具列表 | — |
| `GET /cli-hub/api/agents/sessions` | 当前所有活着的 Agent 会话 | — |
| `GET /cli-hub/api/events` | SSE 事件流（实时推送扫描进度 / 额度告警 / Agent 状态变化） | — |

### POST 端点

所有 POST 接收 JSON body，返回 `{ ok: boolean, message?: string, data?: any }`。

| 路径 | body | 说明 |
|---|---|---|
| `POST /cli-hub/api/action` | `{ id: UiActionId, payload: any }` | 通用动作派发（任意 `UiActionId`） |
| `POST /cli-hub/api/agents/spawn` | `{ adapterId, options? }` | 启动 Agent 子进程 |
| `POST /cli-hub/api/agents/send` | `{ adapterId, sessionId?, message }` | 给 Agent 发一条消息 |
| `POST /cli-hub/api/tools/exec` | `{ toolName, input }` | 直接执行某个 cli-hub 工具 |

### 通用 actionId 列表（`POST /cli-hub/api/action`）

`scan` / `toggle-adapter` / `enable-all-authed` / `disable-all` / `agent-spawn` / `agent-stop` / `agent-stop-all` / `agent-send` / `quota-refresh` / `quota-refresh-all` / `tool-exec` / `show-install-hint` / `adapter-detail`。

### curl 示例

```bash
# 触发 L3 扫描
curl -X POST http://127.0.0.1:3080/cli-hub/api/action \
  -H 'Content-Type: application/json' \
  -d '{"id":"scan","payload":{"depth":"l3"}}'

# 列出已发现的 CLI
curl http://127.0.0.1:3080/cli-hub/api/scan?depth=l3 | jq

# 启用 snow-cli
curl -X POST http://127.0.0.1:3080/cli-hub/api/action \
  -H 'Content-Type: application/json' \
  -d '{"id":"toggle-adapter","payload":{"adapterId":"snow-cli","enabled":true}}'

# spawn 一个 claude-code agent
curl -X POST http://127.0.0.1:3080/cli-hub/api/agents/spawn \
  -H 'Content-Type: application/json' \
  -d '{"adapterId":"claude-code"}'

# 执行 Snow 画图工具
curl -X POST http://127.0.0.1:3080/cli-hub/api/tools/exec \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"cli-hub:snow-cli:draw","input":{"prompt":"a cute corgi","style":"anime"}}'
```

---

## Web UI 使用指南

Web UI 三条挂载路径（按顺序尝试，至少一条必生效）：

1. **`ctx.settings.registerSection`** — DSH 设置页「CLI Hub」卡片，支持 `onAction` 回调直接派发后端动作。
2. **`ctx.clientPages.register`** — DSH 独立路由页 `/cli-hub`，server-driven 组件树。
3. **HTTP REST**（见上文）— 兜底，任何外部前端可 fetch。

### 打开方式

- DSH 设置页 → 滚到「CLI Hub」卡片
- 或浏览器直接访问 `http://127.0.0.1:3080/cli-hub`

### 页面分区

| 区块 | 说明 | 头部动作 |
|---|---|---|
| 概览 (Dashboard) | 扫描时间 / 总数 / 已匹配 / 已启用 / 已认证 / 会话数 | 快速扫描(L1) / 刷新全部额度 |
| 已发现的 AI CLI | 扫描结果表：命令 / 路径 / 版本 / 登录态 / 能力标签 | toggle-adapter / show-install-hint |
| Adapter 开关（全部内置） | 所有注册的 adapter，含未发现的 | toggle-adapter / show-install-hint / adapter-detail |
| 额度监控 | 每个 adapter 的 used / total / remaining / percent / warning | quota-refresh |
| 可用工具 | 已发现且已认证 adapter 的工具列表（含 inputSchema） | tool-exec |
| Agent 会话 | 当前活着的子进程：sessionId / pid / 状态 / 时长 / 协议 | agent-send / agent-stop |

行内按钮直接触发对应 `UiActionId`，结果以 toast / inline 形式展示。

### SSE 事件流

```bash
curl -N http://127.0.0.1:3080/cli-hub/api/events
# 实时推送：cli-detected / scan-progress / quota-warning / agent-spawned ...
```

---

## 配置说明

### 主配置（`cordis.patch.yml` 覆盖）

在 `~/.dsh/profiles/web/cordis.patch.yml` 个人 patch 层追加：

```yaml
- id: cli-hub.core
  override:
    config:
      scan:
        defaultDepth: l3           # l1 只看文件名 / l2 +version / l3 +auth探测
        autoRefreshIntervalSec: 600 # 后台刷新间隔（秒，默认 1800=30 分钟）
        timeoutPerCmd: 2000         # 单次 L2/L3 子命令超时（毫秒）
        showUnknown: true           # 是否展示"疑似 AI CLI 但无 adapter"的命令
      quota:
        cacheTtlSec: 120
        defaultWarningThresholdPercent: 20  # 剩 20% 告警
      gateway:
        failureCooldownCount: 3   # 连错 3 次冷却
        failureCooldownSec: 60
        sandboxLevel: relaxed     # strict=只走 execFile / relaxed=允许工作目录自由读写
      agent:
        singletonPerAdapter: true # 同 adapter 只跑一个 session，spawn 默认复用
        defaultReadyTimeoutMs: 10000
        defaultShutdownGraceMs: 5000
      adapters:
        enabledOverrides:
          claude-code: true
          snow-cli: true
          kimi-cli: false   # 强制禁用某个 adapter
```

### 字段速查

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `scan.defaultDepth` | `'l1'\|'l2'\|'l3'` | `l3` | 首次扫描深度 |
| `scan.autoRefreshIntervalSec` | number | `1800` | 后台刷新间隔，0=禁用 |
| `scan.timeoutPerCmd` | number | `3000` | L2/L3 单次子命令超时 |
| `scan.showUnknown` | boolean | `true` | 是否展示未匹配的"疑似 AI CLI" |
| `quota.cacheTtlSec` | number | `300` | 兜底缓存 TTL（无 adapter 自定义时） |
| `quota.defaultWarningThresholdPercent` | number | `10` | 默认告警阈值 |
| `gateway.failureCooldownCount` | number | `5` | 连错多少次触发冷却 |
| `gateway.failureCooldownSec` | number | `30` | 冷却时长 |
| `gateway.sandboxLevel` | `'strict'` / `'relaxed'` | `strict` | 沙箱级别 |
| `agent.singletonPerAdapter` | boolean | `true` | adapter 级别单例 |
| `agent.defaultReadyTimeoutMs` | number | `10000` | ready 默认超时 |
| `agent.defaultShutdownGraceMs` | number | `5000` | shutdown grace 默认时长 |
| `adapters.enabledOverrides` | `Record<string, boolean>` | `{}` | 强制覆盖某个 adapter 的 enabled |

---

## 开发指南

### 环境准备

```bash
pnpm install
```

### 构建产物

构建采用 **tsc 生成 `.d.ts` + esbuild bundle ESM/CJS** 的两步流程（详见 `scripts/build.mjs`，原本用 tsdown 但 rolldown 在处理 MemberExpression 嵌套时崩溃，故改用 esbuild）：

```bash
pnpm build
# 输出：
#   dist/index.js    (ESM)
#   dist/index.cjs   (CJS)
#   dist/src/**/*.d.ts
```

### 类型检查 / Lint / 测试

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint src tests
pnpm test         # vitest run（54 个用例，p0/p0-webui/p0-agent/p1-webui-interactive）
pnpm test:watch   # 监听模式
```

### 端到端冒烟（不写入 `~/.dsh`）

```bash
node scripts/e2e-smoke.mjs
# 覆盖：apply() 挂载 ctx.cliHub / Scanner 真 L3 扫本机 PATH / AgentGateway spawn+ready+send+recv+shutdown
```

Claude Agent 专项冒烟：

```bash
node scripts/smoke-claude-agent.mjs
```

### 部署到 DSH web profile

最稳的方式（自动 build + pnpm add 本地路径 + 写 bundles + 重启 DSH）：

```bash
bash scripts/install-to-dsh-web.sh
```

脚本行为：

1. `cd` 到插件根目录跑 `pnpm build`
2. `pkill -f "dsh web"` 停掉旧进程
3. `cd ~/.dsh/profiles/web && pnpm add file://<插件路径> --prefer-offline`
4. 用内嵌 Python 脚本把 `dsh-plugin-cli-hub` 加进 `package.json` 的 `dsh.profile.bundles` 数组（幂等）
5. `nohup npx dsh web > /tmp/dsh-web.log 2>&1 &` 重启
6. 打印诊断命令

验证：

```bash
grep -E 'cli-hub|loaded|adapter count' /tmp/dsh-web.log | head -20
```

### 发布到 npm

```bash
pnpm build              # prepublishOnly 会自动执行
pnpm publish --access public
```

### 在 DSH 之外独立运行

```bash
node -e "import('dsh-plugin-cli-hub').then(async m => {
  const ctx = { /* 最小 storage/logger/subprocess */ };
  m.apply(ctx);
  console.log(await ctx.cliHub.scan('l2'));
});"
```

---

## 常见问题

### 1. macOS launchd 后台进程把 PATH 重置了怎么办？

**现象**：DSH 由 `launchd` / `nohup` 拉起时，子进程拿到的 `PATH` 被截断成 `/usr/bin:/bin:/usr/sbin:/sbin`，导致 `claude` / `gemini` / `codex` 等装在 `~/.local/bin` / `/opt/homebrew/bin` 的 CLI 扫不到，日志报 `spawn claude ENOENT`。

**原因**：`launchd` 启动的 GUI/后台进程不会读 `~/.zshrc` / `~/.bash_profile`，PATH 退化为系统默认。

**本插件的解决方案**（已内置，无需用户操作）：`Scanner._listPathEntries()` 和 `_safeExecNative()` 都会主动补全以下目录到 `PATH` 前面：

```
~/.local/bin
/usr/local/bin
/opt/homebrew/bin
/opt/homebrew/sbin
```

**如果还是扫不到**（比如你装在 `~/Library/Application Support/some-cli/bin`），手动解决：

```bash
# 方式 A：在 DSH profile 的启动脚本里显式 export PATH
echo 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"' >> ~/.dsh/profiles/web/env.sh

# 方式 B：用 launchctl setenv 全局注入（重启 DSH 后生效）
launchctl setenv PATH "$HOME/.local/bin:/opt/homebrew/bin:$(launchctl getenv PATH)"

# 方式 C：用绝对路径覆盖 adapter 的 spawn.command
# 在 cordis.patch.yml 里：
# - id: cli-hub.core
#   override:
#     config:
#       adapters:
#         custom:
#           claude-code:
#             agent:
#               spawn:
#                 command: '/Users/wf/.local/bin/claude'
```

### 2. DSH `credentials.yaml` 的 `version` 字段必须是数字

**现象**：插件读取 DSH 的 `~/.dsh/credentials.yaml`（或某个 adapter 的 credentials 文件）时报错 `Cannot read properties of undefined` 或 schema 校验失败。

**原因**：DSH 的 credentials 文件 schema 要求 `version` 字段是 **数字**，而不是字符串。很多人手写 yaml 时习惯性地写成 `version: "1"` 或 `version: '1'`，会被解析成字符串，触发 schema validate 失败。

**正确写法**：

```yaml
# ~/.dsh/credentials.yaml
version: 1            # 注意：不要加引号，必须是数字字面量
credentials:
  anthropic:
    apiKey: sk-ant-xxx
```

**错误写法**（不要这样写）：

```yaml
version: "1"          # 错：被解析成字符串
version: '1'          # 错：被解析成字符串
version: v1           # 错：被解析成字符串
```

排查命令：

```bash
# 看 yaml 解析后 version 的实际类型
node -e "import('js-yaml').then(m => console.log(typeof m.default.load(require('fs').readFileSync(process.env.HOME + '/.dsh/credentials.yaml','utf8')).version))"
# 期望输出：number
```

### 3. Cordis `inject` 白名单问题：`cannot get property "X" without inject`

**现象**：日志出现 `cannot get property "storage" without inject` / `cannot get property "tools" without inject`。

**原因**：Cordis v4 的 ctx proxy trap 规则——如果 fiber 被 loader 加载（`fiber.runtime` 存在），那么读 `ctx.<name>` 时，`<name>` 必须在 `fiber.inject` 数组里，否则直接抛错。

**本插件的解决方案**：

- 主插件 `inject = ['webServer']`（唯一强依赖，必须等 webServer 就绪才激活）
- 其他 service（`storage` / `settings` / `tools` / `logger` / `subprocess`）全部走 `safeGet()` 多路径兜底：`raw/internal` → `service` → `ctx.get(name, false)` → `ctx.reflect.get(name, false)` → `fiber.runtime.services` map → 裸读。

如果你写自定义 sub-plugin 时也遇到，复制 `src/core/safe-get.ts` 或 `src/index.ts` 里的 `safeGet` 实现即可。

### 4. 安装后日志报 `[cli-hub] initial scan error: ...`？

看具体 message：

- `spawn ... ENOENT`：PATH 里没这个 CLI，正常，L1 scan 会跳过；按 [问题 1](#1-macos-launchd-后台进程把-path-重置了怎么办) 检查 PATH。
- `authCheck 超时`：CLI 首次启动要联网 / 要用户手动交互。设 `scan.timeoutPerCmd: 5000`，或把那个 adapter `disable`。

### 5. Agent 模式 ready 超时怎么办？

真实 banner 可能和 Adapter 里写的 `readyPattern` 不一致（比如 CLI 版本升级后 prompt 变了）。

调试：先跑独立命令看 stderr：

```bash
dsh cli-hub agent spawn claude-code
dsh cli-hub agent status claude-code --tail 20
```

然后在 `cordis.patch.yml` 里覆写 pattern：

```yaml
- id: cli-hub.core
  override:
    config:
      adapters:
        custom:
          claude-code:
            agent:
              spawn:
                readyPattern: '"subtype":"hook_started"'   # 新的 prompt 前缀
```

### 6. 额度估算不准？

- Provider 实时查询（HTTP / command / file）优先；没有实时查询时才走 `estimatePerToolCall` / `estimatePerAgentTurn` 累计估算。
- 想更精确：在 Adapter 里提供更精确的 `creditsPerToken` / `creditsPerSecond`，或实现自定义 `estimatePerToolCall` 函数。

### 7. 插件能不能在 DSH 之外单独跑？

可以。见 [开发指南 - 在 DSH 之外独立运行](#在-dsh-之外独立运行)。

### 8. 权限和安全？

- Tool 模式默认 `sandboxLevel=strict`：命令走 `execFile(cmd, [args])`，**不经过 shell**，所以没有 `$()` / `&&` / `|` 注入风险。
- Agent 模式子进程继承当前用户权限，建议在工作区子目录下 spawn（AgentGateway 会自动 `mkdir`）。
- `gateway.failureCooldownCount` 连错保护：连续 N 次失败自动冷却，防止打爆订阅额度。

---

## License

MIT — 同 DeepSeek Harness。
