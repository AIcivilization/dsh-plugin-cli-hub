# Scanner Platform Sources — Design & Convention

> **Language / 语言**: English first · [简体中文在下方](#扫描源平台化设计规范中文)
>
> Status: **ADOPTED** · Applies to `src/core/scanner.ts` and all future platform work.
> Established after the Windows compatibility round (see the 2026-08 patch notes:
> npm shim resolution, codex/opencode probe fixes).

---

## 1. The Decision (read this before touching the scanner)

**ONE scanner pipeline. NEVER fork it per platform.**

The L1 enumerate → L2 version → L3 auth pipeline, fingerprint matching, cooldown and
quota integration are platform-neutral — they are the product's core. Duplicating or
branching them per OS guarantees drift; we already paid for that once when the Windows
patch diverged from main and had to be merged by hand.

Platform differences are allowed in **exactly two places**, both small and isolated:

| # | Concern | Where it lives | Form |
|---|---|---|---|
| 1 | Which directories to scan | `_scanSourceCatalog()` | data-driven table + per-platform **pure functions** |
| 2 | How to execute a discovered binary | `_resolveWinExecutable()` + cmd.exe branch in `_safeExecNative` | already implemented |

Everything else must stay platform-blind. Do not add `if (process.platform === …)` back
into shared pipeline code.

---

## 2. Source Catalog Layout (target architecture)

```ts
interface ScanSource {
  id: string;                              // e.g. 'win-npm-global'
  platforms: NodeJS.Platform[];            // where this source applies
  dirs(ctx: { home: string; env: NodeJS.ProcessEnv }): string[];
}                                          // PURE function: reads nothing global, may fs.readdir/exists
```

`_collectScanDirs()` becomes: flatten catalog entries filtered by `process.platform`,
dedupe preserving first occurrence (existing behaviour), return `string[]`.

### Common sources (all platforms)

- `$PATH` entries (expanded)
- `~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/go/bin`
- pnpm home (`~/.local/share/pnpm`; win: `%LOCALAPPDATA%\pnpm`)
- npm global `bin/` + `lib/node_modules/{pkg}/bin` (via `npm config get prefix`)

### darwin-only

- App bundles: `/Applications/{App}.app/Contents/{MacOS,Resources/bin,Resources/app/bin,Resources/app/modules/ai-agent/bin}` (+ `~/Applications`)
- Homebrew / system: `/usr/local/bin`, `/opt/homebrew/bin`, `/opt/homebrew/sbin`
- Python user scripts: `~/Library/Python/{ver}/bin`

### win32-only (the reason this convention exists)

| Source | Path | Why |
|---|---|---|
| npm global shims | `%APPDATA%\npm` | **the** gathering point of CLIs installed via `npm i -g` on Windows |
| pnpm home | `%LOCALAPPDATA%\pnpm` | pnpm default bin dir |
| Scoop shims | `%USERPROFILE%\scoop\shims` | scoop-installed CLI population |
| Chocolatey | `%PROGRAMDATA%\chocolatey\bin` | choco-installed CLI population |
| App Execution Aliases | `%LOCALAPPDATA%\Microsoft\WindowsApps` | winget / store app aliases |
| Per-user programs | `%LOCALAPPDATA%\Programs\{App}\bin` (curated list) | VS Code–style tools embedding CLIs |

### linux-only

- `/usr/local/bin`, `~/.local/bin` (explicit, even though usually on PATH), `~/.npm-global/bin`
- (extend when the Linux server round starts)

### Rules for every source function

1. Pure function of `{ home, env }` → `string[]`. Never read `process` directly — take
   values as arguments so tests can inject fake environments **on any dev machine**.
2. Missing directories are fine: return them anyway; the collector skips what does not
   exist (existing behaviour).
3. One source = one concern. Adding platform support later = adding table rows, never
   touching the pipeline.
4. Globbing/enumeration (like macOS `.app` bundles) stays inside its own source function.

---

## 3. Execution Semantics Recap (already shipped)

- Extensionless npm shim on win32 → `_resolveWinExecutable()` probes `.cmd/.exe/.bat`.
- `.cmd/.bat` → spawned via `%ComSpec%` `/d /s /c <quoted line>` with
  `windowsVerbatimArguments: true`; args are fingerprint-defined fixed flags, quoting
  covers whitespace/`"&|<>^`.
- POSIX: unchanged, direct `spawn`.

---

## 4. Testing Convention

1. Every source function gets unit tests with **fake directory trees** (tmpdir), runnable
   on macOS/Linux/Windows alike — because inputs are injected, never read globally.
2. Platform-gated integration tests use explicit skips:
   `(process.platform === 'win32' ? it : it.skip)(...)` — visible, not silent.
3. Real-machine validation matrix:

| Machine | Role |
|---|---|
| macOS (this repo) | primary development; runs full suite |
| Windows PC | win32 catalog + execution semantics, tested while coding there |
| Linux server | linux catalog, tested while coding there |

---

## 5. Cross-Machine Workflow (anti-fork rules)

We were burned once: a local Windows patch diverged from `main` and needed manual merging.
Rules to prevent recurrence:

1. **Platform ownership (hard rule):** the Windows machine touches **only win32-owned
   code**: `platforms: ['win32']` catalog rows, `process.platform === 'win32'`-gated
   branches (e.g. `_resolveWinExecutable`), win32-only tests, and win32 docs. It must NOT
   modify common sources, the shared pipeline, darwin/linux rows, or anything else. Same
   applies mutatis mutandis to the future Linux round (linux only touches linux). If a
   shared-code change seems unavoidable — STOP; propose it on `main` first and let the
   primary (macOS) side review and merge it.
2. `main` is the single source of truth. Every platform machine branches from latest
   `main` and pushes back **the same day** — small steps, no long-lived offline forks.
3. Platform-specific edits should confine themselves to: catalog table rows + their tests
   + `docs/`. If you must touch shared pipeline code, call it out in the commit/PR body.
4. Commit messages follow repo style: `type: 中文描述` (semantic prefix kept).
5. After pulling on another machine, rebuild and reinstall into the local DSH profile —
   remember pnpm does NOT detect content changes of `file:` dependencies:
   ```bash
   pnpm remove dsh-plugin-cli-hub && pnpm add file:/abs/path/to/repo
   ```
6. Each machine uses its own isolated DSH profile (e.g. `cli-hub-dev`) — see USAGE.md.

---

## 6. Implementation Checklist (win32 round)

- [x] `_resolveWinExecutable()` + cmd.exe execution branch (done, verified on Win11 + macOS)
- [x] codex `login status` / opencode `auth list` probe fixes (done)
- [ ] Refactor `_collectScanDirs()` into `_scanSourceCatalog()` table (behaviour-neutral on macOS)
- [ ] Add the six win32 source rows (§2)
- [ ] Unit tests for win32 sources with fake trees (green on all dev machines)
- [ ] Validate auto-discovery on a real Windows box (`dsh --profile cli-hub-dev` + dashboard hit-rate)
- [ ] Update README “扫描能力” table with Windows sources

---

---

# 扫描源平台化设计规范（中文）

> 状态：**已采纳**。适用于 `src/core/scanner.ts` 及后续所有平台工作。
> 由 Windows 兼容修复轮次确立（npm shim 解析、codex/opencode 探测修正）。

## 1. 决策（动 scanner 前必读）

**一条扫描流水线，绝不按平台分叉。**

L1 枚举 → L2 版本 → L3 认证、指纹匹配、冷却与额度联动全部平台无关——这是产品核心，
按系统复制或分支必然漂移。Windows 补丁与主线分叉后被迫手工合流的教训已经发生过一次。

平台差异只允许存在于两处：

| # | 关注点 | 位置 | 形态 |
|---|---|---|---|
| 1 | 扫描哪些目录 | `_scanSourceCatalog()` | 数据驱动表 + 各平台**纯函数** |
| 2 | 如何执行发现的二进制 | `_resolveWinExecutable()` + cmd.exe 分支 | 已实现 |

其余代码保持平台盲。禁止把 `if (process.platform === …)` 加回共享流水线。

## 2. 目录源清单（目标架构）

每条源 = `{ id, platforms, dirs({home, env}) }`，`_collectScanDirs()` 变为：
按当前平台过滤目录表 → 展平 → 去重保序（现有行为不变）。

- **公共源**（全平台）：$PATH、`~/.local/bin`、`~/.bun/bin`、`~/.cargo/bin`、`~/go/bin`、pnpm home、npm 全局 bin 与 `lib/node_modules/{pkg}/bin`
- **darwin 专属**：App bundle 内嵌 CLI、Homebrew/系统目录、`~/Library/Python/{ver}/bin`
- **win32 专属**：`%APPDATA%\npm`（npm -g 的 CLI 聚集地）、`%LOCALAPPDATA%\pnpm`、`~\scoop\shims`、`%PROGRAMDATA%\chocolatey\bin`、`%LOCALAPPDATA%\Microsoft\WindowsApps`、`%LOCALAPPDATA%\Programs\{App}\bin`
- **linux 专属**：`/usr/local/bin`、`~/.local/bin`、`~/.npm-global/bin`（服务器实测时再扩充）

源函数三条铁律：
1. 入参只吃 `{ home, env }`，不直接读 `process` —— 任何开发机都能注入假环境跑测试；
2. 目录不存在没关系，照常返回，收集器会跳过（现有行为）；
3. 一条源一件事；未来加平台支持 = 加表行，不动流水线。

## 3. 执行语义（已上线）

无扩展名 shim → `_resolveWinExecutable()` 探测 `.cmd/.exe/.bat`；`.cmd/.bat` 经
`%ComSpec%` `/d /s /c` 执行（引号包裹特殊字符 + `windowsVerbatimArguments`）；POSIX 直连 spawn 不变。

## 4. 测试约定

- 每条源函数配假目录树单测（tmpdir 注入），三台开发机都能绿；
- 平台专属集成测试显式跳过：`(process.platform === 'win32' ? it : it.skip)(...)`；
- 实测矩阵：macOS=主开发机跑全量；Windows PC=边写 win32 代码边实测；Linux 服务器=同理。

## 5. 跨机器协作（防分叉铁律）

曾被烧过一次：本地 Windows 补丁偏离 main 被迫手工合流。规则：

1. `main` 是唯一真源；各平台机器从最新 main 拉分支，**当天改动当天合回**，小步快跑，禁止长期离线分叉；
2. 平台专属修改只允许落在：目录表行 + 对应测试 + docs/；要动共享流水线必须在提交说明里声明；
3. 提交信息沿用仓库风格 `type: 中文描述`；
4. 换机器拉完代码记得重建重装本地 profile——pnpm 对 `file:` 依赖不检测内容变化，必须
   `pnpm remove dsh-plugin-cli-hub && pnpm add file:/绝对路径`；
5. 每台机器用独立隔离 profile（如 `cli-hub-dev`），见 USAGE.md。

## 6. win32 轮实施清单

- [x] `_resolveWinExecutable()` + cmd.exe 执行分支（已完成，Win11 与 macOS 双端验证）
- [x] codex `login status` / opencode `auth list` 探测修正（已完成）
- [ ] `_collectScanDirs()` 重构为 `_scanSourceCatalog()` 表（macOS 行为零变化）
- [ ] 新增六条 win32 源（见 §2）
- [ ] win32 源的假目录树单测（所有开发机可跑）
- [ ] 真 Windows 机验证自动发现命中率
- [ ] 更新 README「扫描能力」表格补充 Windows 来源
