# Contributing to dsh-plugin-cli-hub

Thank you for considering contributing code to dsh-plugin-cli-hub 🙌.
This project is a community-driven DSH plugin whose goal is to let any DSH user turn the
AI CLIs they already hold paid subscriptions for on their own machine into Tools / Agents callable by DSH.

---

## 1. Setting up the development environment

**Hard requirements** (no lower versions accepted):

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 18.18 | `brew install node@20` (or use nvm / volta / fnm) |
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| DSH | 0.1.0-rc.8+ | See the official DeepSeek Harness repository |
| gh CLI (recommended) | — | `brew install gh && gh auth login` |

**Optional**:
- Rust toolchain (only if you need to modify oxlint upstream; this repo only consumes the oxlint npm package, so not needed)
- Log into at least 2-3 AI CLIs (Claude Code, Snow, Kimi, etc.) for end-to-end testing

**Clone + install dependencies**:

```bash
git clone https://github.com/<your-fork>/dsh-plugin-cli-hub.git
cd dsh-plugin-cli-hub
pnpm install --frozen-lockfile
```

---

## 2. How to add a new adapter (4 steps)

Target: done in 10 minutes. Example: adding a hypothetical new CLI `foo-cli`.

### Step 1: Write the adapter definition

Create `src/adapters/builtin/foo-cli.ts` by copying the template from `copilot.ts` or `snow-cli.ts`,
then change these 6 things:

1. `id`: **kebab-case, required, unique**, e.g. `foo-cli`
2. `name` / `description` / `vendor` / `officialDoc` / `installHint`
3. `fingerprint.commandNames`: at least two candidate names, e.g. `['foo', 'foo-cli']`
4. `fingerprint.authCheck`: run something like `foo auth status`, inspect the output, and write two regexes
5. `capabilities.tools[]`: if it is a one-shot tool (drawing/translation/TTS...), prefer writing the
   commandMapping with **`kind: 'argv'`** (do not use the deprecated template)
6. `quota`: if the vendor has a `quota` / `usage` / `billing` command, configure `kind: 'command'`;
   otherwise `kind: 'unknown'` is fine

### Step 2: Register in BUILTIN_ADAPTERS

Open `src/adapters/builtin/index.ts`, find the `BUILTIN_ADAPTERS` array, and add your exported
`fooCliAdapter` to it (alphabetically or in the matching A/B/C/D/E group).

### Step 3: Three gates before you file the PR

```bash
pnpm typecheck     # must be 0 errors
pnpm test          # the new adapter must pass the registry unit tests at least
pnpm build         # confirm esbuild / tsdown can bundle it
# recommended additions:
node scripts/show-quota.mjs    # see adapter id=foo-cli appear in the scanned/not-scanned list
```

### Step 4: Submit the PR

Use Conventional Commits style for commit messages (not enforced, but don't blame us if CI complains):

```
feat(adapter): add foo-cli (6 capabilities, provider quota)
```

Paste a screenshot or text of the `show-quota.mjs` output into the PR description.

---

## 3. Local debugging

### 3.1 Unit tests

```bash
pnpm test                        # run everything
pnpm test tests/p0.spec.ts       # run only p0
pnpm test --run --reporter=verbose
```

### 3.2 E2E smoke

```bash
node scripts/e2e-smoke.mjs        # combined Scanner + Registry + Quota + ToolGateway pass
node scripts/smoke-claude-agent.mjs  # if claude is logged in on this machine
```

### 3.3 Debugging in a real DSH environment (use profile isolation! Don't pollute your web profile)

```bash
# install this plugin into a clean profile = dev-cli-hub
dsh plugin --profile dev-cli-hub add file:///path/to/dsh-cli

# open DSH pointed at the dev-cli-hub config
dsh --profile dev-cli-hub ...

# check whether cli-hub loaded correctly in the logs
grep -E '(cli-hub|DEPRECATE|cooldown)' ~/.dsh/profiles/dev-cli-hub/*.log
```

Reinstall after changing code:
```bash
dsh plugin --profile dev-cli-hub remove dsh-plugin-cli-hub
pnpm build
dsh plugin --profile dev-cli-hub add file:///path/to/dsh-cli
```

### 3.4 Standalone quota view (no DSH required)

```bash
node scripts/show-quota.mjs     # table output; supports --json / --no-color
```

---

## 4. Code style

- **TypeScript strict** (configured in tsconfig). Every PR must pass `pnpm typecheck`.
- **Lint**: `pnpm lint` (oxlint; defaults are fine).
- **Unit test style**:
  - vitest with describe/it/expect
  - every new capability -> at least one positive test plus one boundary/error-branch test
  - ToolGateway argv safety must have unit tests (see the ToolGateway describe in tests/p0.spec.ts)
- Do **not** leave `console.log` in production code; use the Cordis ctx logger:
  ```ts
  const l = safeGetCtx(ctx, 'logger'); if (typeof l === 'function') l('my-tag').info(...);
  ```

---

## 5. PR workflow

1. Click **Fork** in GitHub's top-right corner -> fork to your own account
2. Create a branch: `git checkout -b feat/foo-cli` (or `fix/xxx` / `docs/xxx`)
3. Make sure these 4 commands are green locally:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   node scripts/e2e-smoke.mjs
   ```
4. Commit, push to your fork, open a PR against `dsh-plugin-cli-hub:main`
5. Tick the checkboxes in the PR template one by one
6. CI green + maintainer review → squash merge

### How to flag breaking changes

Breaking changes during v0.x:

1. Prefix the PR title with `BREAKING: `
2. Manually add a `## [Unreleased] -> BREAKING CHANGES` section to CHANGELOG.md
3. If you changed the ToolCapabilityDeclaration / CliAdapterDefinition types:
   - bump the minor of `package.json version` (e.g. `0.1.0 -> 0.2.0`)
   - provide a migration note in cordis.patch.yml if needed

---

## 6. Release (maintainers only)

Full checklist in [`RELEASING.md`](./RELEASING.md). Order:

```
pnpm typecheck → pnpm test → pnpm build → e2e-smoke →
git tag vX.Y.Z → git push + git push origin vX.Y.Z →
pnpm publish --access public →
scripts/release-smoke-install.sh --channels ABC --gh-user <you> →
write Release Notes on the GitHub Release page ->
post in DSH Discussions Show and tell ->
wait 3 days and check whether dsh-market / dsh-plugins.top / deepseek-harness-plugin.com have indexed it.
```

---

## 7. Reporting security issues

Do **not** describe security bugs in public Issues (e.g. an adapter authCheck that can be forged,
a resolver that can execute arbitrary commands, QuotaManager cache leaking tokens, etc.).

The right way: email the maintainer (see package.json `author` or the GitHub profile email); for
sensitive reports prefer the maintainer's GPG key if one is provided.

Maintainer commitments for this project:
- acknowledge receipt within 24 hours
- triage within 72 hours (high severity fixed within 7 days; medium 14 days; low in the next minor release)
- publish a GitHub Security Advisory as soon as the fix lands, and call it out separately in the CHANGELOG
- credit the original reporter (if the author wishes to be named)

---

## 8. Code of conduct

We follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
In one sentence: **respect people, take code seriously, disagree politely**. Maintainers may close
violating PRs / Issues; severe cases (personal attacks, harassment, etc.) lead to a GitHub block.
