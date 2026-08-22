# Contributing to dsh-plugin-cli-hub

首先感谢你考虑给 dsh-plugin-cli-hub 贡献代码 🙌。
本项目是社区驱动的 DSH 插件，目标是让任何 DSH 用户都能一键把"自己本机已经买好会员的
AI CLI"变成 DSH 可以调用的 Tool / Agent。

---

## 1. 开发环境准备

**硬性依赖**（版本不能更低）：

| 工具 | 最低版本 | 安装 |
|---|---|---|
| Node.js | 18.18 | `brew install node@20`（或用 nvm / volta / fnm）|
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| DSH | 0.1.0-rc.8+ | 参见 DeepSeek Harness 官方仓库 |
| gh CLI（推荐） | — | `brew install gh && gh auth login` |

**可选**：
- Rust toolchain（如果你要改 oxlint 的上游；本仓库只消费 oxlint npm 包，不需要）
- 至少登录 2-3 个 AI CLI（Claude Code、Snow、Kimi 等）以便端到端

**克隆 + 安装依赖**：

```bash
git clone https://github.com/<your-fork>/dsh-plugin-cli-hub.git
cd dsh-plugin-cli-hub
pnpm install --frozen-lockfile
```

---

## 2. 怎么加一个新 adapter（4 步）

目标 10 分钟搞定。例子：加一个 Hypothetical 新 CLI `foo-cli`。

### Step 1：写 adapter 定义

新建 `src/adapters/builtin/foo-cli.ts`，直接从 `copilot.ts` 或 `snow-cli.ts` 复制模板，
改 6 处：

1. `id`: **kebab-case，必填，唯一**，例如 `foo-cli`
2. `name` / `description` / `vendor` / `officialDoc` / `installHint`
3. `fingerprint.commandNames`：至少两个候选名，例如 `['foo', 'foo-cli']`
4. `fingerprint.authCheck`：跑 `foo auth status` 之类看看输出，写两个正则
5. `capabilities.tools[]`：如果它是一次性的（画图/翻译/TTS…），建议用
   **`kind: 'argv'`** 写 commandMapping（不要用 deprecated 的 template）
6. `quota`：如果官方有 `quota` / `usage` / `billing` 命令就配 `kind: 'command'`；
   没有就 `kind: 'unknown'` 也没关系

### Step 2：注册到 BUILTIN_ADAPTERS

打开 `src/adapters/builtin/index.ts`，找到 `BUILTIN_ADAPTERS` 数组，把你导出的
`fooCliAdapter` 加进去（按字母顺序或者放到对应 A/B/C/D/E 分组里）。

### Step 3：验证前的三道门槛

```bash
pnpm typecheck     # 必须 0 errors
pnpm test          # 新增 adapter 至少过一遍 tests 里的 registry 单测
pnpm build         # 确认 esbuild / tsdown 能打包
# 推荐再加：
node scripts/show-quota.mjs    # 看到 adapter id=foo-cli 出现在扫到/未扫到列表里
```

### Step 4：提交 PR

提交信息建议使用 Conventional Commits 风格（不强求，但 CI 挂了别怪它）：

```
feat(adapter): add foo-cli (6 capabilities, provider quota)
```

PR 描述里粘 `show-quota.mjs` 的输出截图或文本。

---

## 3. 本地调试

### 3.1 单元测试

```bash
pnpm test                        # 跑全部
pnpm test tests/p0.spec.ts       # 只跑 p0
pnpm test --run --reporter=verbose
```

### 3.2 E2E 冒烟

```bash
node scripts/e2e-smoke.mjs        # Scanner + Registry + Quota + ToolGateway 联合走
node scripts/smoke-claude-agent.mjs  # 如果本机登录了 claude
```

### 3.3 真 DSH 环境调试（推荐 profile 隔离！别污染自己的 web）

```bash
# 把本插件装到一个干净的 profile = dev-cli-hub
dsh plugin --profile dev-cli-hub add file:///path/to/dsh-cli

# 打开 DSH，让它读 dev-cli-hub 配置
dsh --profile dev-cli-hub ...

# 看日志里 cli-hub 是否正确加载
grep -E '(cli-hub|DEPRECATE|cooldown)' ~/.dsh/profiles/dev-cli-hub/*.log
```

修改代码后重新安装：
```bash
dsh plugin --profile dev-cli-hub remove dsh-plugin-cli-hub
pnpm build
dsh plugin --profile dev-cli-hub add file:///path/to/dsh-cli
```

### 3.4 独立额度查看（不依赖 DSH）

```bash
node scripts/show-quota.mjs     # 表格输出，支持 --json / --no-color
```

---

## 4. 代码风格

- **TypeScript strict**（tsconfig 已配置）。所有 PR 必须通过 `pnpm typecheck`。
- **Lint**：`pnpm lint`（oxlint，默认即可）。
- **单测风格**：
  - 用 vitest + describe/it/expect
  - 加一个新能力 → 至少一个正例单测 + 一个边界/错误分支单测
  - ToolGateway argv 安全必须有单测（见 tests/p0.spec.ts ToolGateway describe）
- **不要**把 `console.log` 留在生产代码里，用 Cordis ctx logger：
  ```ts
  const l = safeGetCtx(ctx, 'logger'); if (typeof l === 'function') l('my-tag').info(...);
  ```

---

## 5. 提 PR 流程

1. 点 GitHub 右上角 **Fork** → fork 到你自己的账号
2. 新建分支 `git checkout -b feat/foo-cli`（或 `fix/xxx` / `docs/xxx`）
3. 本地确保 4 条命令都绿：
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   node scripts/e2e-smoke.mjs
   ```
4. 提交、推到 fork，开 PR 到 `dsh-plugin-cli-hub:main`
5. PR template 里的 checkboxes 一个一个勾
6. CI green + maintainer review → squash merge

### Breaking change 怎么标

v0.x 期间破变更：

1. PR 标题开头加 `BREAKING: `
2. CHANGELOG.md 里手动追加 `## [Unreleased] → BREAKING CHANGES` 小节
3. 如果改了 ToolCapabilityDeclaration / CliAdapterDefinition 类型：
   - 升级 `package.json version` 的 minor（例如 `0.1.0 → 0.2.0`）
   - 在 cordis.patch.yml 里写好 migration（需要的话）

---

## 6. Release（只有 maintainer 能做）

完整 checklist 见 [`RELEASING.md`](./RELEASING.md)。顺序：

```
pnpm typecheck → pnpm test → pnpm build → e2e-smoke →
git tag vX.Y.Z → git push + git push origin vX.Y.Z →
pnpm publish --access public →
scripts/release-smoke-install.sh --channels ABC --gh-user <you> →
GitHub Release 页面写 Release Notes →
发 DSH Discussions Show and tell 帖 →
等 3 天看 dsh-market / dsh-plugins.top / deepseek-harness-plugin.com 是否收录。
```

---

## 7. 安全问题报告

**不要**在公开 Issue 里描述安全 bug（例如某个 adapter 的 authCheck 可以被伪造、某个
resolver 能执行任意命令、QuotaManager 缓存泄漏 token 等）。

正确方式：邮件 maintainer（见 package.json `author` 或 GitHub profile 邮箱），如果
敏感，建议使用 maintainer 提供的 GPG key（如果有）。

本项目维护者承诺：
- 24 小时内回复确认收到
- 72 小时内给出 triage（高危 7 天出修复；中危 14 天；低危下个 minor release）
- 修复后第一时间发 GitHub Security Advisory，并在 CHANGELOG 里单独标注
- 首发披露者 attribution（如果作者愿意署名）

---

## 8. 行为准则

我们使用 [Contributor Covenant v2.1](https://www.contributor-covenant.org/zh-cn/version/2/1/code_of_conduct/)。
总结一句：**对人尊重、对代码认真、有不同意见好好说**。违反的 PR / Issue maintainer
有权关闭；严重者（人身攻击、骚扰等）GitHub 拉黑。
