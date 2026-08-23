# dsh-plugin-cli-hub Release Plan v0.1.0

> Goal: publish this plugin to a public GitHub repository and get it indexed by the three third-party
> plugin marketplaces (dsh-market / dsh-plugins.top / deepseek-harness-plugin.com) through the DSH
> community's agreed `dsh-plugin` topic mechanism, so users can install it with one click via
> `dsh plugin add` or the visual `dsh-market`.

**Plan version: v0.1.0 (first public Developer Preview release)**
**Target release date: 2026-08-22 (ship once all P0 items are done; unfinished P1 items go on the Roadmap)**

---

## 1. Phase overview

| Phase | Level | Name | Effort | Parallelizable |
|---|---|---|---|---|
| 0 | — | Write this plan document | 0.25d | — |
| 1 | P0 | package.json release metadata + LICENSE + trademark disclaimers | 0.5d | parallel with 2 |
| 2 | P0 | Security audit: ToolGateway template rendering defaults to argv lists; string concatenation forbidden | 1d | not parallel with 1 |
| 3 | P0 | dsh.profile bundle metadata verification + real DSH install smoke test | 1d | not parallel with 2 |
| 4 | P1 | CHANGELOG.md + CONTRIBUTING.md | 0.5d | parallel with 5 |
| 5 | P1 | GitHub CI workflow + Issue/PR templates | 0.75d | parallel with 4 |
| 6 | P1 | Bilingual README + Web UI screenshot placeholders | 1d | parallel with 7 |
| 7 | P1 | 10 adapter smoke scripts + three-channel install validation | 1.5d | parallel with 6 |
| 8 | P0 | Full verification + git commit + push command list | 0.5d | — |

**Total workload: ~7 person-days (of which P0 ≈ 3.25d, P1 ≈ 3.75d)**

---

## 2. Detailed tasks and acceptance criteria per phase

### Phase 1 (P0): package.json release metadata + LICENSE + THIRD_PARTY_NOTICES

#### 1.1 Complete package.json

Check the fields below and fill in anything missing:

| Field | Requirement |
|---|---|
| `name` | `dsh-plugin-cli-hub` (check whether npm registry already has it; if taken switch to the scoped `@yourname/dsh-plugin-cli-hub`) |
| `version` | `0.1.0` |
| `description` | One line: `DeepSeek Harness plugin: auto-scans 33+ local AI CLIs and reuses their subscribed quotas as Tool & Agent modes.` |
| `main` | `dist/index.cjs` |
| `module` | `dist/index.js` |
| `types` | `dist/src/index.d.ts` |
| `exports` | `{ ".": { types, import, require, default }, "./package.json": "./package.json" }` |
| `files` | `[ "dist", "README.md", "LICENSE", "package.json" ]` (must not publish tests/ or scripts/*.mjs; if scripts/install-to-dsh-web.sh is kept it needs a separate note) |
| `keywords` | `[ "dsh-plugin", "deepseek-harness", "deepseek", "dsh", "ai-cli", "claude", "codex", "gemini", "ollama", "tool", "agent", "quota", "adapter" ]` |
| `license` | `MIT` |
| `author` | your GitHub username + email (optional) |
| `repository` | `{ "type": "git", "url": "git+https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub.git" }` (**fill in after pushing**; placeholder OK first) |
| `homepage` | `https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub#readme` (same placeholder rule) |
| `bugs` | `{ "url": "https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub/issues" }` (same) |
| `engines` | `{ "node": ">=18.18" }` |
| `os` | not required (code already supports mac/linux) |
| `dsh.profile` | keep existing bundle fields in package.json and verify key names match DSH rc.8 |
| `peerDependencies` | check whether an `@deepseek-ai/dsh` peer dep is needed (at least `">=0.1.0-rc.8"`, optional) |
| `scripts.prepublishOnly` | `pnpm build` (auto-build before publishing to npm) |
| `scripts.prepack` | `pnpm build && pnpm test --run` (automation before npm pack) |

**Acceptance**: `pnpm publish --dry-run --access public` output contains no files outside dist, and the extracted `npm pack` tarball is < 2MB.

#### 1.2 LICENSE file

Create `/LICENSE` with the standard MIT text:

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

**Acceptance**: file exists, attribution correct.

#### 1.3 THIRD_PARTY_NOTICES.md (trademark disclaimers)

Create `/THIRD_PARTY_NOTICES.md`, stating clearly:

- dsh-plugin-cli-hub is a community open-source project, **not affiliated with** DeepSeek AI / Anthropic / OpenAI / Google / xAI / Moonshot / ByteDance / GitHub or any other company
- AI CLI product names, logos and trademarks belong to their respective owners
- The plugin only **invokes CLIs the user has installed and licensed** on the user's local machine; it never holds any user API key
- List license summaries of this project's third-party npm dependencies (cordis / esbuild / vitest etc.; read them from node_modules rather than by hand — generate with `license-checker-rseidelsohn`)

**Acceptance**: file exists; disclaimers cover every vendor mentioned.

---

### Phase 2 (P0): Security audit — ToolGateway template rendering switches to argv by default

**Current problem**: the adapter definition's `commandMapping.template` is a Handlebars-style string such as
`'copilot suggest "{{prompt}}" --language {{language}} --json'`.

- If `prompt` contains double quotes, semicolons or backticks, we use `execFile` (no shell), but the argv
  single-string argument passed to the child process still gets polluted, so `prompt` can be truncated or
  subcommands parsed under different syntax rules
- Also, `kimi read --file "{{file}}"` breaks into two arguments when `file` contains spaces

**Three things to do:**

#### 2.1 Add a new `commandMapping` field `argv: string[]` taking priority

Each adapter's `commandMapping` allows exactly one of two forms (`argv` takes precedence):

```ts
interface ArgvCommandMapping {
  kind: 'argv';
  command: string;           // e.g. 'copilot'
  args: Array<string | { var: string; defaultValue?: string }>;
  // e.g.
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
  template: string;          // kept for backward compatibility but DEPRECATED (log warning)
  workdirVar?: string;
}
```

#### 2.2 Add argv rendering logic to `_renderCommand` in `gateway-tool.ts`

- `kind === 'argv'`: walk the args list, substitute variables, and emit each `{ var }` as its own argv[i]
  with no shell/string splitting at all; skip the flag+value pair entirely when defaultValue is empty
  (e.g. no `--language ''` when language is empty)
- `kind === 'template'`: keep working, but log a DSH warning nudging adapter authors to migrate to argv
- Add universal safety assertions: every argument must be `typeof === 'string'`, must not contain `\0`
  (NUL byte), and is capped at 100,000 characters (memory-DoS protection)

#### 2.3 Migrate **all 33 adapters'** `commandMapping` from template to argv

This is sizable work and **can be deprioritized to P1**, but the following 6 adapters have declared
Tool-mode capability and must migrate first:

1. claude-code
2. snow-cli
3. kimi-cli
4. officecli
5. copilot (the most capable of the 12 newly added ones)
6. codex

**Acceptance**:
- `pnpm test` passes (tests covering template rendering need matching updates)
- `gateway-tool` has unit tests for "argv prompt containing double quotes/semicolons is not truncated"
  and "file path with spaces stays one argument"
- at least the 6 core adapters complete the argv migration

---

### Phase 3 (P0): dsh.profile bundle metadata verification + real DSH install smoke test

#### 3.1 Verify package.json dsh.* fields

Read the `dsh.profile.*` / `bundles` fields in package.json and align them with how DSH rc.8 actually loads:

- Check that paths inside `dsh.profile.web.bundles` are relative like `./dist/index.cjs`
- Check that `exports` declares the plugin's CJS main entry
- Make sure the field name `dsh.profile.default` (or `dsh.profile.web.default`?) matches DSH's internal convention

**Verification when unsure**: do a real install with DSH once and look for `bundle not found` in the load logs.

#### 3.2 Verify all three install channels for real

Verify each channel inside an isolated `~/.dsh/profiles/cli-hub-test` profile (don't pollute your daily web profile):

| Channel | Command | Acceptance |
|---|---|---|
| A. local file path | `dsh plugin --profile cli-hub-test add file:///path/to/dsh-cli` | DSH log shows `cli-hub loaded. adapter count=33`; `dsh cli-hub scan l1` produces output |
| B. GitHub repo (after push) | `dsh plugin --profile cli-hub-test add github:{you}/dsh-plugin-cli-hub` | same + remote package.json readable |
| C. npm package (after publish) | `dsh plugin --profile cli-hub-test add npm:dsh-plugin-cli-hub@0.1.0` | same + downloaded tarball verified |

Acceptance checklist:
- No `[cli-hub] init error` on DSH startup
- `dsh cli-hub list` shows all 33 adapters
- `dsh cli-hub scan l3` finds >= 7 CLIs
- Web UI opens and shows the "CLI Hub" card
- Pick any logged-in CLI (say claude-code), run `dsh cli-hub tool exec cli-hub:claude-code:run-task '{...}'` once; it must not crash and must return normally

**Put the acceptance commands into one bash script**: `scripts/release-smoke-install.sh`, for users to run themselves.

---

### Phase 4 (P1): CHANGELOG.md + CONTRIBUTING.md

#### 4.1 CHANGELOG.md (keep-a-changelog format)

```markdown
# Changelog

## [0.1.0] - 2026-08-22

### Added
- 33 built-in AI CLI adapters (A commercial cloud 10 / B IDE-embedded 6 / C local-model gateway 5 / D open-source Agent 8 / E general LLM 4)
- Scanner three-layer auto-discovery (L1/L2/L3) covering 6 scan sources, fixing the macOS launchd PATH reset problem
- QuotaManager: command/http/file/unknown queries + local estimation accumulation + TTL + threshold warnings
- ToolGateway: discovered & enabled CLIs registered as DSH ctx.tools; safe argv execution + sandbox + cooldown
- AgentGateway: stream-json / stdio-jsonrpc / line-based / mcp-stdio / acp multi-protocol
- Web UI: 6 sections + SSE + 12 HTTP endpoints + 3 mount paths (settings/standalone route/REST)
- DSH CLI: dsh cli-hub scan|list|enable|disable|quota|tool|agent ... subcommands
- scripts/show-quota.mjs: standalone quota view
- 54 unit tests + e2e-smoke.mjs + smoke-claude-agent.mjs

### Known Issues (important! users should know)
- Only the claude-code / snow-cli Agent modes are end-to-end verified against real environments
- Most adapters' quota queries currently take the estimate path (no provider-native API)
- 27 ToolGateway adapters still use template commandMapping (migrate to argv next minor)
- Windows platform untested (only macOS arm64 guaranteed)
```

#### 4.2 CONTRIBUTING.md

Section list:
- dev environment setup (Node >= 18.18 + pnpm + gh CLI)
- how to add a new adapter (4 steps + commands): codex.ts as template -> register in index.ts -> typecheck/test -> show-quota verification
- how to debug (scripts/e2e-smoke.mjs / scripts/show-quota.mjs / real DSH profile isolation)
- code style: `.editorconfig` aligned with the DSH repo, use oxlint (this repo doesn't configure oxlint yet? file an Issue to add it)
- testing convention: `tests/*.spec.ts`; each new adapter gets at least one scanner fingerprint unit test plus one Tool unit test (if it declares Tool capability)
- PR workflow: fork -> branch feat/xxx -> locally pass `pnpm typecheck && pnpm test && pnpm build && node scripts/e2e-smoke.mjs` -> commit -> green CI -> request review
- release process: only maintainers tag/release; release checklist (see Phase 8)
- security issues: never file security bugs in public Issues; email the maintainer (GPG key optional)

---

### Phase 5 (P1): GitHub CI workflow + Issue/PR templates

#### 5.1 `.github/workflows/ci.yml`

Triggers:
- `push main`
- `pull_request` from any branch -> main
- `workflow_dispatch` manual trigger

Job: `build-and-test` (ubuntu-latest + Node 18/20/22 matrix, since DSH requires Node >= 18.18)

Steps:
1. `actions/checkout@v4`
2. `pnpm/action-setup@v4`
3. `actions/setup-node@v4` (cache: 'pnpm', matrix.node-version)
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck` -> CI fails if this fails
6. `pnpm build`
7. `pnpm test` (vitest --run) + upload coverage via `actions/upload-artifact@v4`
8. (optional but recommended) `pnpm lint` (if oxlint configured)

#### 5.2 `.github/ISSUE_TEMPLATE/config.yml`

Two links:
- Bug Report -> bug_report.yml
- Feature Request -> feature_request.yml

#### 5.3 `.github/ISSUE_TEMPLATE/bug_report.yml`

Fields:
- checkbox: I tried reinstalling
- checkbox: I confirm I am on the latest version
- DSH version (e.g. 0.1.0-rc.8)
- Node version
- OS (macOS arm64 / macOS x64 / Linux / Windows)
- install method (npm / GitHub / local file)
- reproduction steps (multiline)
- expected behavior
- actual behavior
- relevant logs (output of `grep cli-hub /tmp/dsh-web.log`)
- extra attachments

#### 5.4 `.github/ISSUE_TEMPLATE/feature_request.yml`

Fields:
- use case (why it is needed)
- proposed solution
- alternatives considered
- screenshots or reference links

#### 5.5 `.github/PULL_REQUEST_TEMPLATE.md`

Checklist:
- [ ] I ran `pnpm typecheck`
- [ ] I ran `pnpm test` (added/fixed tests)
- [ ] I ran `pnpm build`
- [ ] I ran `node scripts/e2e-smoke.mjs`
- [ ] new adapter: registered in `BUILTIN_ADAPTERS` and added a row to the supported-AI-CLI table in README.md
- [ ] breaking change: noted in CHANGELOG.md under Added/Breaking changes
- [ ] updated relevant docs (README / configuration section / FAQ)

---

### Phase 6 (P1): bilingual README + Web UI screenshot placeholders

#### 6.1 README translation

- Keep the Chinese README.md (primary entry for domestic users) and add a fully English `README.en.md`
- Add a language switcher line at the top of README.md: `中文 | [English](./README.en.md)`, consistent with the official DSH repository
- Also add `README.i18n.yaml` (optional; the DSH website reads it), structured like the official DSH format

**Translation focus (not word-for-word; pitch it to the target reader)**:
- 特性 -> Features
- 快速开始 -> Quick Start
- 支持的 AI CLI -> Supported AI CLIs (keep the A-E group titles, translated)
- 架构设计 -> Architecture
- HTTP API -> keep section names
- Web UI -> Web UI Guide
- 配置说明 -> Configuration
- 开发指南 -> Development
- 常见问题 -> FAQ
- Roadmap -> keep
- License -> keep

#### 6.2 Web UI screenshot placeholders

Create the `docs/screenshots/` directory in the repo and embed per-section images in the README:

```md
## Web UI preview

| Dashboard (overview) | Discovered AI CLIs | Adapter toggles |
|---|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Discovered](docs/screenshots/discovered.png) | ![Switches](docs/screenshots/adapters.png) |

| Quota monitoring | Tool list | Agent sessions |
|---|---|---|
| ![Quota](docs/screenshots/quota.png) | ![Tools](docs/screenshots/tools.png) | ![Agents](docs/screenshots/agents.png) |
```

Start each slot with a **placeholder SVG** (ASCII or a simple HTML/SVG rectangle reading "screenshot to be uploaded"); replace with real screenshots once taken manually. After Phase 7, run `bash scripts/install-to-dsh-web.sh` and capture the 6 screenshots by hand.

---

### Phase 7 (P1): 10 adapter smoke scripts + three-channel install validation

#### 7.1 Add new smoke scripts (e2e-smoke + smoke-claude-agent already exist)

One per core adapter, six in total:
1. `scripts/smoke-snow-cli.mjs` — Snow CLI Tool drawing + Agent REPL
2. `scripts/smoke-kimi-cli.mjs` — Kimi web search + long-document reading (when public web access works)
3. `scripts/smoke-officecli.mjs` — OfficeCLI PPT-generation command dispatch
4. `scripts/smoke-copilot.mjs` — Copilot suggest + explain (requires copilot login on this machine)
5. `scripts/smoke-codex.mjs` — Codex run-task (if codex is logged in)
6. `scripts/smoke-10-adapters.mjs` — runs only L2 scanning + fingerprint verification (10 mainstream CLIs), no login required

Each script prints up front whether login is needed, and gracefully skips instead of erroring out when not logged in.

#### 7.2 `scripts/release-smoke-install.sh`

Wraps the three install-channel test commands from Phase 3.2 so users don't type them by hand:
```bash
#!/usr/bin/env bash
set -euo pipefail
PROFILE="cli-hub-release-test"
echo "==> Cleaning profile $PROFILE"
rm -rf ~/.dsh/profiles/"$PROFILE"
mkdir -p ~/.dsh/profiles/"$PROFILE"
# ... run the three channels one by one
```

**Acceptance**: channel A (file://) passes at minimum; run the other two manually after GitHub push / npm publish.

---

### Phase 8: full verification + git commit + push command list

#### 8.1 Pre-release checklist (goes into `RELEASING.md`)

```
Release Checklist — v0.1.0
==========================
[ ] 1. pnpm typecheck      → 0 errors
[ ] 2. pnpm test           → 54 passed
[ ] 3. pnpm build          -> dist/*.cjs + dist/*.js + *.d.ts exist
[ ] 4. node scripts/e2e-smoke.mjs -> all phases green
[ ] 5. node scripts/show-quota.mjs -> at least 7 CLIs found
[ ] 6. pnpm pack --dry-run -> tarball < 2MB, file list correct
[ ] 7. scripts/release-smoke-install.sh -> channel A passes
[ ] 8. CHANGELOG.md / README.md / README.en.md up to date
[ ] 9. git status clean (except docs/screenshots/*.png pending upload)
[ ] 10. git remote set-url origin correct and able to push
[ ] 11. npm whoami -> logged into the target account
```

#### 8.2 Release command list (for you to execute)

```bash
# === 1. commit local code ===
git add -A
git commit -m "release: v0.1.0"
git tag v0.1.0 -m "release v0.1.0: 33 AI CLIs + Tool + Agent + Web UI"

# === 2. push to GitHub (first time) ===
# first create the public repo dsh-plugin-cli-hub at https://github.com/new (choose Public; do NOT tick README/.gitignore/LICENSE)
git remote add origin git@github.com:{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub.git
git branch -M main
git push -u origin main
git push origin v0.1.0

# === 3. add GitHub topics (on the web) ===
# open https://github.com/{YOUR_GITHUB_USERNAME}/dsh-plugin-cli-hub
# About -> Settings gear -> Topics: dsh-plugin, deepseek-harness, ai-cli, tools, agent, quota
# About Description: copy package.json's description
# About Website: the repo homepage URL

# === 4. publish the GitHub Release ===
# web -> Releases -> Draft new release
#   Tag: v0.1.0
#   Target: main
#   Release title: v0.1.0
#   Description: paste the [0.1.0] section from CHANGELOG.md
#   check Set as a pre-release (this is a 0.x Developer Preview)
#   do not attach binaries

# === 5. publish to npm ===
npm whoami
# if not logged in: npm login
pnpm publish --access public
# verify: npm view dsh-plugin-cli-hub@0.1.0 shows up

# === 6. three-channel install validation ===
bash scripts/release-smoke-install.sh

# === 7. posts / PRs for exposure ===
# a. DSH Discussions Show and tell
# b. plugin intro post on Doubao channels / CSDN / Juejin
# c. PR a line into 0xsline/awesome-deepseek-harness

# === 8. check indexing (takes effect within ~3 days after publishing) ===
# open http://dsh-plugins.top -> search "cli-hub" or "dsh-plugin-cli-hub"
# open https://deepseek-harness-plugin.com/zh-CN/plugins/ -> search
# install dsh-market inside DSH -> search cli-hub
```

---

## 3. Post-release metrics

Check these metrics one month after release to prioritize v0.2.0:

| Metric | Healthy value | Action when below |
|---|---|---|
| GitHub Stars | > 100 | write a Juejin/Zhihu post; PR an awesome-list |
| npm weekly downloads | > 50 | double-check the README install commands; inspect the dsh-market index |
| Active Issues | < 5 | fix Issue bugs first before adding features |
| dsh-market indexed | yes | if missing: manually PR dsh-market/plugins.json |
| deepseek-harness-plugin.com featured | try to apply | featured requires > 500 stars; chase 500 first |

---

## 4. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| package.json name `dsh-plugin-cli-hub` already taken | low | npm publish fails | switch to the scoped name immediately: `@yourname/dsh-plugin-cli-hub`; update README accordingly |
| dsh plugin add fails to load (bundle format incompatible with rc.8) | medium | users cannot install | debug via dsh startup logs first; fall back to testing against dsh v0.1.0-rc.7 if necessary |
| argv migration breaks a tool call for some authenticated CLI | medium | poor UX | keep the template compatibility path with a warning; add argv unit tests for the affected adapter |
| not indexed by dsh-market within 3 days of GitHub push | medium | poor exposure | manually PR the dsh-market repo; also post recommendations in the CSDN DeepSeek community |
| security audit finds a flaw in some adapter's authCheck logic | low | security incident | ship a v0.1.1 hotfix immediately, default-disable that adapter, and announce via GitHub advisory |

---

*Plan version v0.1.0, last updated 2026-08-21. This file is updated as phases progress.*
