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

#### 1. 33 built-in AI CLI adapters (5 categories)

**A. Commercial cloud AI CLIs (10)**
Claude Code, Kimi CLI (Moonshot), Snow CLI (Mistral/Snowflake AI), Gemini CLI,
Groq CLI, OfficeCLI, Qwen CLI (Alibaba Tongyi), Doubao CLI (ByteDance),
GLM CLI (Zhipu), MiniMax CLI.

**B. IDE-embedded AI entry CLIs (6)**
Codex CLI (Trae), Copilot CLI, Windsurf CLI, Cursor CLI, Cline CLI, Devin Desktop CLI.

**C. Local model / gateway CLIs (5)**
Ollama, llama.cpp, LM Studio CLI, Jan CLI, LiteLLM Proxy CLI.

**D. Open-source Agent / autonomous coding CLIs (8)**
Aider, Continue.dev, OpenHands (formerly OpenDevin) CLI, Goose CLI (Block),
Smol Developer, OpenClaudia, Paperclip AI, FreeBuf CLI.

**E. General-purpose LLM chat CLIs (4)**
tgpt, aichat (Sigoden), LLM CLI (Simon Willison), Chatblade,
Soul5 CLI, Junie CLI, CatPaw CLI.

#### 2. Scanner — three-layer auto-discovery covering 6 scan sources

- `L1` fingerprint match on executable names; `L2` version extraction; `L3` login-state verification.
- Scan sources: `$PATH`, common user bin dirs (~/.local/bin, ~/.cargo/bin, ~/.bun/bin, etc.),
  macOS app bundles `/Applications/*.app/Contents/**/bin`, system package-manager bins,
  npm global, Python user scripts.
- Fixes the classic macOS problem where launchd resets PATH and brew/homebrew bins cannot be found.

#### 3. QuotaManager — quota query + local estimation

- Four query methods: `command` / `http` / `file` / `unknown` (fallback).
- Per tool call and per Agent turn, `used` accumulates via estimator functions; TTL cache + threshold warnings.
- Output shape: `source / currency / total / used / remaining / period / refreshedAt / breakdown`.

#### 4. ToolGateway — all discovered CLIs auto-registered as DSH ctx.tools

- **New `kind: 'argv'` safe command mapping (recommended)** passes arguments as an array,
  inherently avoiding quote/space injection; `kind: 'template'` remains for backward
  compatibility (DEPRECATE log warning, removal in v0.2.0).
- Safety assertions on all render paths: NUL bytes rejected and a 100,000-character limit.
- Two sandbox levels, strict / relaxed; N consecutive failures trigger a failureCooldown.
- Call history persistence + event bus `tool-called / tool-succeeded / tool-failed`.

#### 5. AgentGateway — spawn standalone sub-agents over 5 protocols

- `acp / mcp-stdio / stdio-jsonrpc / line-based / stream-json`。
- `readyPattern` waits for the ready banner; graceful shutdown (SIGINT/SIGTERM + grace ms).
- One singleton per adapter (default). Agent metadata: displayName / avatarEmoji /
  strengths / shareDshTools.

#### 6. Web UI — 6 sections + SSE + 12 HTTP endpoints

- Overview / discovered CLIs / adapter toggles / quota monitoring / tool list / agent session management.
- SSE event stream pushes scan progress, quota changes and call history.
- Mount points: DSH settings card, standalone `/cli-hub` route, REST `/api/cli-hub/v1/*`.

#### 7. DSH CLI subcommands

```bash
dsh cli-hub scan [l1|l2|l3]    # trigger a scan
dsh cli-hub list               # list adapters / toggles
dsh cli-hub enable <id> | disable <id>
dsh cli-hub quota [--adapter <id>]
dsh cli-hub tool exec <toolName> '<json>'
dsh cli-hub agent start <id> | stop <id> | list
```

#### 8. Scripts

- `scripts/show-quota.mjs` — scans and prints quota status independently of DSH (with colors).
- `scripts/e2e-smoke.mjs` / `smoke-claude-agent.mjs` — end-to-end smoke tests.
- `scripts/install-to-dsh-web.sh` — one command to install this plugin into the local `~/.dsh/profiles/web`.
- `scripts/release-smoke-install.sh` — pre-release install verification over the file/GitHub/npm channels.

#### 9. Docs / release metadata

- README rewritten for v0.1.0 with the 6 major features + 33-adapter table + architecture + FAQ + Roadmap.
- package.json filled in with `repository / homepage / bugs / exports.default / files / keywords`.
- `LICENSE` (MIT) + `THIRD_PARTY_NOTICES.md` (trademark disclaimers for 30+ vendors).
- CHANGELOG / CONTRIBUTING / RELEASE-PLAN / RELEASING release checklists.

### Testing

- 54 vitest unit tests (covering the scanner's 6 scan sources, QuotaManager, ToolGateway
  safety, AgentGateway's 5 protocols, adapter registration validation), all passing.
- `pnpm typecheck` 0 errors。
- Gateway argv safety unit tests: double-quote/semicolon injection, paths with spaces, pair skipping, NUL + over-long rejection.

### Known Issues (present in this release; fixes planned for v0.2.0)

1. **27/33 adapters still use `kind: 'template'` in Tool mode**: already marked DEPRECATE
   in types.ts; v0.2.0 migrates everything to `kind: 'argv'` (the core 6 are migrated).
2. **Quota query coverage**: only Claude Code, Snow CLI, Kimi, OfficeCLI and Gemini CLI out of
   the 33 adapters have real provider queries; the rest accumulate via estimates
   (estimatePerToolCall / estimatePerAgentTurn) or report `unknown`.
3. **Agent end-to-end verification**: so far only the claude-code / snow-cli Agent modes have been
   verified against a real environment (spawn + send + recv + shutdown); the other 9 adapters that
   declare agent capability have protocol-appropriate spawn argsTemplate but no real-environment verification.
4. **Platform support**: verified on macOS (arm64 + x64); Linux is compatible in theory (relies on
   POSIX execFile and ~/.config paths) but not CI-tested; Windows is out of scope for v0.1.0.
5. **npm package name collision risk**: current name=`dsh-plugin-cli-hub`. If `pnpm publish`
   reports 403 name taken, switch to the scoped name immediately: `@<gh-user>/dsh-plugin-cli-hub`,
   and update the README install commands, package.json `files`, and cordis.patch.yml `name` accordingly.

---

## [0.1.0-rc.1] — UNRELEASED (pre-release internal)

All changes above were developed internally and consolidated as `v0.1.0` for the first
public release. No prior public version was published.
