# dsh-plugin-cli-hub 发布计划 v0.1.0

> 目标：把本插件发布到 GitHub 公开仓库，并通过 DSH 社区约定的 `dsh-plugin` topic 机制被三个第三方插件市场（dsh-market / dsh-plugins.top / deepseek-harness-plugin.com）收录，让用户能用 `dsh plugin add` / `dsh-market` 可视化一键装。

**计划版本：v0.1.0 (Developer Preview 首次公开发布)**
**发布日期目标：2026-08-22（完成所有 P0 即可发，P1 可不做完但要列在 Roadmap）**

---

## 一、阶段总览

| 阶段 | 级别 | 名称 | 用时估算 | 可并行 |
|---|---|---|---|---|
| 0 | — | 写本计划文档 | 0.25d | — |
| 1 | P0 | package.json 发布元数据 + LICENSE + 商标免责 | 0.5d | 可与 2 并行 |
| 2 | P0 | 安全审计：ToolGateway 模板渲染默认走 argv 列表，禁止字符串拼接 | 1d | 不能与 1 并行 |
| 3 | P0 | dsh.profile bundle 元数据验证 + 真 DSH 安装冒烟 | 1d | 不能与 2 并行 |
| 4 | P1 | CHANGELOG.md + CONTRIBUTING.md | 0.5d | 可与 5 并行 |
| 5 | P1 | GitHub CI workflow + Issue/PR 模板 | 0.75d | 可与 4 并行 |
| 6 | P1 | README 双语 + Web UI 截图占位 | 1d | 可与 7 并行 |
| 7 | P1 | 10 个 adapter smoke 脚本 + 安装方式三通道校验 | 1.5d | 可与 6 并行 |
| 8 | P0 | 全量验证 + git 提交 + push 命令清单 | 0.5d | — |

**总工作负荷：约 7 人天（其中 P0 ≈ 3.25d，P1 ≈ 3.75d）**

---

## 二、每个阶段的详细任务与验收标准

### Phase 1 (P0): package.json 发布元数据 + LICENSE + THIRD_PARTY_NOTICES

#### 1.1 package.json 完善

检查字段，缺失的补齐：

| 字段 | 要求 |
|---|---|
| `name` | `dsh-plugin-cli-hub`（检查 npm registry 是否占用；占用则改 `@yourname/dsh-plugin-cli-hub` scoped 包） |
| `version` | `0.1.0` |
| `description` | 一句话：`DeepSeek Harness plugin: auto-scans 33+ local AI CLIs and reuses their subscribed quotas as Tool & Agent modes. | 自动扫描本机 33+ AI CLI，复用已订阅额度作为 DSH Tool & Agent。` |
| `main` | `dist/index.cjs` |
| `module` | `dist/index.js` |
| `types` | `dist/src/index.d.ts` |
| `exports` | `{ ".": { types, import, require, default }, "./package.json": "./package.json" }` |
| `files` | `[ "dist", "README.md", "LICENSE", "package.json" ]`（不能把 tests/ 或 scripts/*.mjs 发上去，scripts/install-to-dsh-web.sh 若要保留需单独说明） |
| `keywords` | `[ "dsh-plugin", "deepseek-harness", "deepseek", "dsh", "ai-cli", "claude", "codex", "gemini", "ollama", "tool", "agent", "quota", "adapter" ]` |
| `license` | `MIT` |
| `author` | 你的 GitHub 用户名 + 邮箱（可选）|
| `repository` | `{ "type": "git", "url": "git+https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub.git" }`（**等 Push 后再填**，可先占位）|
| `homepage` | `https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub#readme`（同上占位）|
| `bugs` | `{ "url": "https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub/issues" }`（同上）|
| `engines` | `{ "node": ">=18.18" }` |
| `os` | 不需要写（但代码已兼容 mac/linux）|
| `dsh.profile` | 当前 package.json 里有的 bundle 字段，保留并核对 key 名与 DSH rc.8 一致 |
| `peerDependencies` | 检查是否需要 `@deepseek-ai/dsh` peer dep（至少写 `">=0.1.0-rc.8"`，且 optional） |
| `scripts.prepublishOnly` | `pnpm build`（发布 npm 前自动构建） |
| `scripts.prepack` | `pnpm build && pnpm test --run`（有 npm pack 前自动化） |

**验收**：`pnpm publish --dry-run --access public` 输出里没有 dist 之外的文件，且 `npm pack` 解压后大小 < 2MB。

#### 1.2 LICENSE 文件

新建 `/LICENSE`，标准 MIT 文本：

```
MIT License

Copyright (c) 2026 {YOUR_GITHUB_USERNAME_OR_NAME}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**验收**：文件存在，署名准确。

#### 1.3 THIRD_PARTY_NOTICES.md（商标免责）

新建 `/THIRD_PARTY_NOTICES.md`，列清楚：

- dsh-plugin-cli-hub 是社区开源项目，**不隶属于** DeepSeek AI / Anthropic / OpenAI / Google / xAI / Moonshot / ByteDance / GitHub 等公司
- 各 AI CLI 产品名、Logo、商标归各自版权方所有
- 本插件仅在用户本地计算机上**调用用户已安装和已授权**的 CLI，不持有任何用户 API Key
- 列出本项目的第三方 npm 依赖（cordis / esbuild / vitest 等）的 license 摘要（从 node_modules 里读就行，不需要手查，用 `license-checker-rseidelsohn` 生成）

**验收**：文件存在，免责声明覆盖所有提到的 vendor。

---

### Phase 2 (P0): 安全审计 — ToolGateway 模板渲染改默认 argv

**当前问题**：adapter 定义里 `commandMapping.template` 是 Handlebars 风格字符串，例如 `'copilot suggest "{{prompt}}" --language {{language}} --json'`。

- 如果 `prompt` 里有双引号、分号、反引号，虽然我们用 `execFile`（不经 shell），但**依然会污染传给子进程的 argv 单字符串参数**，导致 `prompt` 被截断或子命令按不同语法解析
- 另外 `kimi read --file "{{file}}"` 这种如果 `file` 里有空格，会被拆成两个参数

**要做的 3 件事**：

#### 2.1 新增 `commandMapping` 新字段 `argv: string[]` 作为优先

每个 adapter 的 `commandMapping` 允许两种形式，二选一（`argv` 优先级高）：

```ts
interface ArgvCommandMapping {
  kind: 'argv';
  command: string;           // 例如 'copilot'
  args: Array<string | { var: string; defaultValue?: string }>;
  // 例：
  // [
  //   'suggest',
  //   { var: 'prompt' },
  //   '--language',
  //   { var: 'language', defaultValue: 'bash' },
  //   '--json'
  // ]
}
interface TemplateCommandMapping {
  kind: 'template';
  template: string;          // 保留向后兼容，但 DEPRECATED（log 警告）
  workdirVar?: string;
}
```

#### 2.2 `gateway-tool.ts` 里 `_renderCommand` 新增 argv 渲染逻辑

- `kind === 'argv'`：遍历 args 列表，变量替换后，每个 `{ var }` 是独立的 argv[i]，不经过任何 shell/字符串分割；空 defaultValue 就跳过该 flag+value（例如 language 为空时不传 `--language ''`）
- `kind === 'template'`：保留，但在 DSH 日志里打 warning，提示 adapter 开发者迁移到 argv
- 新增通用安全断言：所有参数 `typeof === 'string'` 且不包含 `\0`（NUL 字节），长度上限 100,000 字符（防内存 DoS）

#### 2.3 把 **所有 33 个 adapter** 的 `commandMapping` 从 template 迁移到 argv

这个工作比较多，**可以优先级排 P1**，但至少以下 6 个是"已声明能跑 Tool 模式"的 adapter，必须先迁：

1. claude-code
2. snow-cli
3. kimi-cli
4. officecli
5. copilot（新增的 12 个里功能最强的一个）
6. codex

**验收**：
- `pnpm test` 通过（如果有测试覆盖 template 渲染的需要同步改测试）
- `gateway-tool` 里有单元测试：`argv 中 prompt 含双引号和分号不被截断`、`file path 含空格不拆参数`
- 至少 6 个核心 adapter 完成 argv 迁移

---

### Phase 3 (P0): dsh.profile bundle 元数据验证 + 真 DSH 安装冒烟

#### 3.1 package.json dsh.* 字段核对

读 package.json 里的 `dsh.profile.*`、`bundles` 字段，和 DSH rc.8 实际加载机制对齐：

- 检查 `dsh.profile.web.bundles` 里的路径是 `./dist/index.cjs` 相对路径
- 检查 `exports` 里有没有声明插件的 CJS 主入口
- 确保 `dsh.profile.default`（或者 `dsh.profile.web.default`？）这个字段名和 DSH 内部约定一致

**不确定时的验证方式**：用 DSH 真装一次看，看加载日志里有没有 `bundle not found`。

#### 3.2 三种安装通道真实走通

在独立的 `~/.dsh/profiles/cli-hub-test` profile（别污染你日常用的 web）里逐个验证：

| 方式 | 命令 | 验收 |
|---|---|---|
| A. 本地 file 路径 | `dsh plugin --profile cli-hub-test add file:///Users/wf/自进化/临时/dsh-cli` | DSH 日志里 `cli-hub loaded. adapter count=33`，`dsh cli-hub scan l1` 有输出 |
| B. GitHub 仓库（push 后）| `dsh plugin --profile cli-hub-test add github:{you}/dsh-plugin-cli-hub` | 同上 + 能读到远端的 package.json |
| C. npm 包（publish 后）| `dsh plugin --profile cli-hub-test add npm:dsh-plugin-cli-hub@0.1.0` | 同上 + 下载 tarball 校验通过 |

验收清单：
- DSH 启动无 `[cli-hub] init error`
- `dsh cli-hub list` 列出 33 个 adapter
- `dsh cli-hub scan l3` 能扫到 >= 7 个 CLI
- Web UI 打开后能看到「CLI Hub」卡片
- 任选一个已登录的 CLI（比如 claude-code），触发一次 `dsh cli-hub tool exec cli-hub:claude-code:run-task '{...}'`，不挂掉，能正常返回

**验收命令写进一个 bash 脚本**：`scripts/release-smoke-install.sh`，让用户自己跑。

---

### Phase 4 (P1): CHANGELOG.md + CONTRIBUTING.md

#### 4.1 CHANGELOG.md（keep-a-changelog 格式）

```markdown
# Changelog

## [0.1.0] - 2026-08-22

### Added
- 33 个内置 AI CLI adapter（A 商业云端 10 / B IDE 内嵌 6 / C 本地模型网关 5 / D 开源 Agent 8 / E 通用 LLM 4）
- Scanner 三层自动发现（L1/L2/L3），覆盖 6 类扫描源，解决 macOS launchd PATH 重置问题
- QuotaManager：command/http/file/unknown 四种查询 + 本地估算累计 + TTL + 阈值告警
- ToolGateway：已发现且已启用 CLI 注册为 DSH ctx.tools，argv 安全执行 + 沙箱 + 冷却
- AgentGateway：stream-json / stdio-jsonrpc / line-based / mcp-stdio / acp 多协议
- Web UI：6 section + SSE + 12 HTTP 端点 + 3 挂载路径（settings/独立路由/REST）
- DSH CLI：dsh cli-hub scan|list|enable|disable|quota|tool|agent ... 子命令
- scripts/show-quota.mjs：独立额度查看
- 54 个单元测试 + e2e-smoke.mjs + smoke-claude-agent.mjs

### Known Issues（重要！用户需要知道）
- 33 个 adapter 中仅 claude-code / snow-cli 的 Agent 模式经过端到端真环境验证
- 大多数 adapter 的 quota 查询当前走 estimate 路径（无 provider 原生 API）
- ToolGateway 的 27 个 adapter 仍在使用 template commandMapping（下一个 minor 版本迁移到 argv）
- Windows 平台未经完整测试（只保证 macOS arm64）
```

#### 4.2 CONTRIBUTING.md

章节清单：
- 开发环境准备（Node ≥ 18.18 + pnpm + gh CLI）
- 怎么加新 adapter（4 步 + 命令）：codex.ts 模板参考 → index.ts 注册 → typecheck/test → show-quota 验证
- 怎么调试（scripts/e2e-smoke.mjs / scripts/show-quota.mjs / 真 DSH profile 隔离）
- 代码风格：`.editorconfig` 对齐 DSH 仓库、使用 oxlint（但本仓库还没配 oxlint？提 Issue 补）
- 测试约定：`tests/*.spec.ts`，新增 adapter 至少一个 scanner 指纹单测 + 一个 Tool 单测（如果声明了 Tool 能力）
- 提 PR 流程：fork → 分支 feat/xxx → 本地通过 `pnpm typecheck && pnpm test && pnpm build && node scripts/e2e-smoke.mjs` → 提交 → 通过 CI → request review
- 发布流程：只有 maintainer 能打 tag/release，发布 checklist（见 Phase 8）
- 安全问题：不要在公开 Issue 提安全 bug，邮箱联系 maintainer（GPG key 可选）

---

### Phase 5 (P1): GitHub CI workflow + Issue/PR 模板

#### 5.1 `.github/workflows/ci.yml`

触发条件：
- `push main`
- `pull_request` 任何分支 → main
- `workflow_dispatch` 手动触发

Job：`build-and-test`（ubuntu-latest + Node 18/20/22 矩阵，因为 DSH 要求 Node ≥ 18.18）

步骤：
1. `actions/checkout@v4`
2. `pnpm/action-setup@v4`
3. `actions/setup-node@v4`（cache: 'pnpm'，matrix.node-version）
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck` → 如果失败，CI 挂
6. `pnpm build`
7. `pnpm test`（vitest --run）+ `actions/upload-artifact@v4` 上传 coverage
8. （可选但推荐）`pnpm lint`（如果配 oxlint）

#### 5.2 `.github/ISSUE_TEMPLATE/config.yml`

两个链接：
- Bug Report → bug_report.yml
- Feature Request → feature_request.yml

#### 5.3 `.github/ISSUE_TEMPLATE/bug_report.yml`

字段：
- 复选框：我试过重装
- 复选框：我确认是最新版
- DSH 版本号（例如 0.1.0-rc.8）
- Node 版本号
- OS（macOS arm64 / macOS x64 / Linux / Windows）
- 安装方式（npm / GitHub / local file）
- 复现步骤（多行）
- 预期行为
- 实际行为
- 相关日志（`grep cli-hub /tmp/dsh-web.log` 的输出）
- 补充附件

#### 5.4 `.github/ISSUE_TEMPLATE/feature_request.yml`

字段：
- 用例（为什么需要）
- 想怎么解决
- 其他替代方案
- 截图或参考链接

#### 5.5 `.github/PULL_REQUEST_TEMPLATE.md`

Checklist：
- [ ] 我运行了 `pnpm typecheck`
- [ ] 我运行了 `pnpm test`（新增了/修复了测试）
- [ ] 我运行了 `pnpm build`
- [ ] 我运行了 `node scripts/e2e-smoke.mjs`
- [ ] 如果是新 adapter：我在 `BUILTIN_ADAPTERS` 里注册了，并在 README.md 支持的 AI CLI 表里加了一行
- [ ] 如果是破坏性变更：已在 CHANGELOG.md Added/Breaking changes 里注明
- [ ] 已更新相关文档（README / 配置章节 / FAQ）

---

### Phase 6 (P1): README 双语 + Web UI 截图占位

#### 6.1 README 英译

- 保留中文 README.md（国内用户主入口），加 `README.en.md` 全英文版本
- 在 README.md 顶部加一行 `中文 | [English](./README.en.md)` 的语言切换链接，和 DSH 官方仓库保持一致
- 同步地加 `README.i18n.yaml`（可选，DSH 官网会读），结构对齐 DSH 官方的格式

**翻译重点（不是逐字翻，按目标读者语气）**：
- 特性 → Features
- 快速开始 → Quick Start
- 支持的 AI CLI → Supported AI CLIs（分组标题保留 A-E，英文译）
- 架构设计 → Architecture
- HTTP API → 保留 section 名
- Web UI → Web UI Guide
- 配置说明 → Configuration
- 开发指南 → Development
- 常见问题 → FAQ
- Roadmap → 保留
- License → 保留

#### 6.2 Web UI 截图占位

在仓库里新建 `docs/screenshots/` 目录，README 里按 section 嵌入：

```md
## Web UI 预览

| Dashboard（概览）| 已发现的 AI CLI | Adapter 开关 |
|---|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Discovered](docs/screenshots/discovered.png) | ![Switches](docs/screenshots/adapters.png) |

| 额度监控 | 工具列表 | Agent 会话 |
|---|---|---|
| ![Quota](docs/screenshots/quota.png) | ![Tools](docs/screenshots/tools.png) | ![Agents](docs/screenshots/agents.png) |
```

每张图都先放一张 **占位 SVG**（用 ASCII 或者简单的 HTML/SVG 矩形图写上文字"截图待上传"），等用户手动截真图后替换。Phase 7 结束后让用户 `bash scripts/install-to-dsh-web.sh` 然后用截图工具手动截 6 张。

---

### Phase 7 (P1): 10 个 adapter smoke 脚本 + 三通道安装校验

#### 7.1 新增 4 个 smoke 脚本（现有已有 e2e-smoke + smoke-claude-agent）

按 6 个核心 adapter 各一个：
1. `scripts/smoke-snow-cli.mjs` — Snow CLI Tool 画图 + Agent REPL
2. `scripts/smoke-kimi-cli.mjs` — Kimi 联网搜索 + 长文档阅读（能查公开网页的话）
3. `scripts/smoke-officecli.mjs` — OfficeCLI 生成 PPT 命令下发
4. `scripts/smoke-copilot.mjs` — Copilot suggest + explain（需要本机登录 copilot）
5. `scripts/smoke-codex.mjs` — Codex run-task（如果 codex 已登录）
6. `scripts/smoke-10-adapters.mjs` — 只跑 L2 扫描和 fingerprint 验证（10 个主流 CLI），不依赖登录态

每个脚本开头打印"需要登录吗"，没登录就优雅 skip，不整个报错退出。

#### 7.2 `scripts/release-smoke-install.sh`

封装 Phase 3.2 里三个安装通道的测试命令，不用用户手敲：
```bash
#!/usr/bin/env bash
set -euo pipefail
PROFILE="cli-hub-release-test"
echo "==> Cleaning profile $PROFILE"
rm -rf ~/.dsh/profiles/"$PROFILE"
mkdir -p ~/.dsh/profiles/"$PROFILE"
# ... 三个通道依次跑
```

**验收**：至少通道 A（file://）通过，其他两个等 GitHub push/npm publish 后由用户手动跑。

---

### Phase 8: 全量验证 + git 提交 + push 命令清单

#### 8.1 发布前 checklist（写进 `RELEASING.md`）

```
Release Checklist — v0.1.0
==========================
[ ] 1. pnpm typecheck      → 0 errors
[ ] 2. pnpm test           → 54 passed
[ ] 3. pnpm build          → dist/*.cjs + dist/*.js + *.d.ts 存在
[ ] 4. node scripts/e2e-smoke.mjs → all phases green
[ ] 5. node scripts/show-quota.mjs → 至少 7 CLI 扫到
[ ] 6. pnpm pack --dry-run → tarball 大小 < 2MB，文件列表正确
[ ] 7. scripts/release-smoke-install.sh → 通道 A 通过
[ ] 8. CHANGELOG.md / README.md / README.en.md 最新
[ ] 9. git status clean（除了 docs/screenshots/*.png 待上传）
[ ] 10. git remote set-url origin 正确，且能 push
[ ] 11. npm whoami → 已登录到目标账号
```

#### 8.2 发布命令清单（给用户执行）

```bash
# === 1. 提交本地代码 ===
git add -A
git commit -m "release: v0.1.0"
git tag v0.1.0 -m "release v0.1.0: 33 AI CLIs + Tool + Agent + Web UI"

# === 2. 推到 GitHub（首次）===
# 先去 https://github.com/new 手动创建公开仓库 dsh-plugin-cli-hub（选 Public，不要勾 README/.gitignore/LICENSE）
git remote add origin git@github.com:{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub.git
git branch -M main
git push -u origin main
git push origin v0.1.0

# === 3. 打 GitHub topic 标签（网页上操作）===
# 打开 https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub
# About → Settings ⚙️ → Topics 里输入：dsh-plugin, deepseek-harness, ai-cli, tools, agent, quota
# About 里 Description 填 package.json 的 description
# About 里 Website 填仓库主页即可

# === 4. 发 GitHub Release ===
# 网页上 → Releases → Draft new release
#   Tag: v0.1.0
#   Target: main
#   Release title: v0.1.0
#   Description 复制 CHANGELOG.md 的 [0.1.0] 章节
#   ✓ Set as a pre-release（因为是 0.x Developer Preview）
#   不 Attach binaries

# === 5. 发 npm ===
npm whoami
# 若未登录：npm login
pnpm publish --access public
# 验证：npm view dsh-plugin-cli-hub@0.1.0 能看到

# === 6. 三通道安装验证 ===
bash scripts/release-smoke-install.sh

# === 7. 发帖/提交 PR 获取曝光 ===
# a. DSH Discussions Show and tell
# b. 豆包频道 / CSDN / 掘金 发插件介绍文
# c. 给 0xsline/awesome-deepseek-harness 提 PR 加一行

# === 8. 检查收录（发布后 3 天内生效）===
# open http://dsh-plugins.top → 搜 "cli-hub" 或 "dsh-plugin-cli-hub"
# open https://deepseek-harness-plugin.com/zh-CN/plugins/ → 搜
# 在 DSH 里装 dsh-market → 搜 cli-hub
```

---

## 三、发布后指标

发布 1 个月后检查以下指标，决定 v0.2.0 的优先级：

| 指标 | 健康值 | 低于时采取动作 |
|---|---|---|
| GitHub Stars | > 100 | 发一篇掘金/知乎推文；去 awesome-list 提 PR |
| npm 周下载 | > 50 | 排查 README 安装命令是否写对；检查 dsh-market 索引 |
| 活跃 Issues | < 5 个 | 先解决 Issue 里的 bug，再考虑加功能 |
| dsh-market 收录 | ✓ 已收录 | 未收录：手动提交 PR 到 dsh-market/plugins.json |
| deepseek-harness-plugin.com 精选 | 尝试申请 | 精选 > 500⭐，先冲 500⭐ |

---

## 四、风险 & 降级

| 风险 | 概率 | 影响 | 降级方案 |
|---|---|---|---|
| package.json name `dsh-plugin-cli-hub` 被占用 | 低 | npm publish 失败 | 立刻改 scoped name：`@yourname/dsh-plugin-cli-hub`，README 同步改 |
| dsh plugin add 加载失败（bundle 格式不兼容 rc.8）| 中 | 用户装不上 | 优先定位 dsh 启动日志；必要时回退到 dsh v0.1.0-rc.7 测试 |
| argv 迁移导致某个已认证 CLI Tool 调用挂掉 | 中 | 用户体验差 | 保留 template 兼容路径，加 warn，先不删；同时补对应 adapter 的 argv 单测 |
| GitHub push 后 3 天未被 dsh-market 收录 | 中 | 曝光差 | 手动 PR 到 dsh-market 仓库；同时去 CSDN DeepSeek 社区发推荐帖 |
| 安全审计发现某个 adapter 的 authCheck 逻辑有漏洞 | 低 | 安全事故 | 立刻发布 v0.1.1 热修复，把那个 adapter 默认 disabled，并在 GitHub advisory 里发公告 |

---

*本计划版本：v0.1.0，最后更新 2026-08-21。随 Phase 进展实时更新本文件。*
