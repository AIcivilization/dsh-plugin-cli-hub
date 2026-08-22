# PR 描述

<!--
  🧹 提 PR 前请把上面这段 HTML 注释里的 📌 看完，把 checklist 一项一项勾上。
  缺少 checklist 的 PR maintainer 会请求补全再 review。
-->

## 变更类型（勾选相关的，可以多选）

- [ ] 🐛 Bugfix（非破坏性变更，修 bug）
- [ ] ✨ Feature（非破坏性变更，加功能/加 adapter）
- [ ] 💥 Breaking Change（会导致使用方式不兼容）→ 必须在下方单独写 "BREAKING:" 段落
- [ ] 📝 Documentation（只改文档 / README / changelog / CONTRIBUTING）
- [ ] 🧪 Test（只补单测 / smoke）
- [ ] 🔧 CI / Tooling（GitHub Actions、脚本、配置）

## 变更内容

<!--
  简要描述你改了什么。对于 adapter PR，请粘贴：
    - adapter id & name
    - show-quota.mjs 里 fingerprint 匹配的输出（或至少 `xx --version`）
    - 新 capabilities 表（每个 tool / agent 列一行）
-->

...

## 关联 Issue / 讨论帖（Closes #xx）

<!-- 例如 Closes #123 会自动关 Issue。相关 PR 也可以提一下。 -->

...

## 破坏性变更详细说明（如有，且必须写）

BREAKING: ...

---

## 自检 Checklist

### 基本质量（**必须全部勾**）

- [ ] 我在本地运行了 `pnpm typecheck`，0 errors。
- [ ] 我在本地运行了 `pnpm test`，全部通过；新增了相应的单测覆盖正例和错误分支。
- [ ] 我在本地运行了 `pnpm build`，dist 产物生成且大小合理。
- [ ] 我在本地运行了 `node scripts/e2e-smoke.mjs`，没有致命错误（exit code ≠ 1）。

### 如果是**新增 / 修改 adapter**（适用则勾）

- [ ] adapter 定义已在 `src/adapters/builtin/index.ts` 的 `BUILTIN_ADAPTERS` 中注册。
- [ ] commandMapping 使用推荐的 `kind: 'argv'`（而不是 deprecated 的 `kind: 'template'`）。
- [ ] Tool 模式至少写了一个 smoke 脚本或单测调用过：`dsh cli-hub tool exec ...` 返回结果正常。
- [ ] Agent 模式（如声明了）的 spawn argsTemplate 已手动跑过至少一次 spawn + close。
- [ ] README.md 的「支持的 AI CLI」表格里已加入一行。
- [ ] 对应 CHANGELOG.md `[Unreleased] → Added` 小节里加了一句。

### 如果是破坏性变更

- [ ] 我已在 CHANGELOG.md 单独加了 `## [Unreleased] → BREAKING CHANGES` 小节。
- [ ] version 字段已按 v0.x 约定 bump 到下一个 minor。

### 文档

- [ ] README.md（中文）和 README.en.md（英文）已同步更新对应章节。
- [ ] 配置参数变化 → 已在 README 的「配置说明 / 配置项总表」里更新。
- [ ] 新 API endpoint / 新 DSH CLI 子命令 → 已在 README 对应章节里加命令示例。
