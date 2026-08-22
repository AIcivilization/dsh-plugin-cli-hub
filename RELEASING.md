# RELEASING.md

> Maintainer-only release checklist. Don't open a PR against this file unless you're
> updating the process itself.

Applicable for v0.x Developer Preview releases (before v1.0.0 contract freeze).
Versioning rule during v0.x: **bugfix bumps patch, breaking change / feature bump bumps minor**.

---

## 0. 每次发布前你都要做的准备（一次性）

### 0.1 Accounts

You need these accounts before you can publish the first release:

| What | Where | Note |
|---|---|---|
| GitHub account (with write access to repo) | https://github.com — create public repo `dsh-plugin-cli-hub` | **Do not** tick "Initialize with README" / LICENSE / .gitignore when creating the repo. We'll push an existing tree. |
| npm account | https://www.npmjs.com/signup | Check name availability at https://www.npmjs.com/package/dsh-plugin-cli-hub — if **taken**, switch to scoped name BEFORE filling package.json's `repository:` URL (see "If the npm name is taken" in §4). |
| (Optional) `gh` CLI | `brew install gh && gh auth login` | Convenient for opening the DSH discussions Show-and-tell post from CLI. |

### 0.2 Local tooling

- `node --version` ≥ 18.18 (20 LTS recommended for build/publish)
- `pnpm --version` ≥ 9 (`corepack enable; corepack prepare pnpm@9 --activate`)
- `dsh --version` ≥ **0.1.0-rc.8** (for channel-A/C install smoke)
- `npm whoami` returns your username (run `npm login` if not)
- `git remote -v` points to the real public GitHub repo

---

## 1. Full release checklist (order matters)

Execute these **top to bottom**. Do not skip lines unless they are marked (optional).

```
RELEASE-CHECKLIST v0.X.Y ==========================================================

  [ ] 1.1 `pnpm typecheck`   → 0 errors.
  [ ] 1.2 `pnpm test`        → All tests pass (54 / 54 for v0.1.0). If you added/
                               changed gateway logic, confirm the NEW argv tests
                               (tests/p0.spec.ts ToolGateway block) all pass.
  [ ] 1.3 `pnpm build`       → dist/index.cjs / dist/index.js / dist/src/index.d.ts
                               exist and are non-empty.
  [ ] 1.4 `node scripts/e2e-smoke.mjs`
                            → exit code must NOT be 1 (= fatal error). It can be
                               non-1 if some CLIs aren't installed on this machine.
  [ ] 1.5 `node scripts/show-quota.mjs`
                            → prints ≥ 7 CLIs on a typical dev Mac. If it prints
                               fewer, your local machine just doesn't have them — it's
                               fine; but you SHOULD confirm 7+ on at least one of your
                               machines before publishing.
  [ ] 1.6 `pnpm pack --dry-run`
                            → Output includes LICENSE, README.md, README.en.md,
                               THIRD_PARTY_NOTICES.md, dist/index.cjs, dist/index.js,
                               cordis.patch.yml, bundle/index.yml. Tarball size ≤ 2 MB.
  [ ] 1.7 `node scripts/smoke-10-adapters-fingerprint.mjs --all`
                            → No ERR rows. L1/L2 SKIPs are OK.
  [ ] 1.8 (optional) Run any of scripts/smoke-{snow-cli,kimi-cli,officecli,
                   copilot,codex,claude-agent}.mjs for adapters you actually have
                   installed and authenticated. At least ONE adapter smoke script
                   should produce ≥ 1 PASS.
  [ ] 1.9 Channel-A install smoke:
            bash scripts/release-smoke-install.sh --channels A --profile release-smoke-a
        → All assertions PASS.
  [ ] 1.10 CHANGELOG.md: update the `## [Unreleased]` section into the actual
         `## [0.X.Y] — YYYY-MM-DD` header. Double-check Known Issues.
  [ ] 1.11 README.md / README.en.md / RELEASE-PLAN.md last spelling pass
         (you'll regret this later — trust me).

  [ ] 1.12 `git status` must be clean.
            git add -A
            git status
        → No "Untracked files", no "Changes not staged".

  [ ] 1.13 Update version in package.json (and commit it):
            # bump manually, or use `npm version` (which also tags):
            npm version --no-git-tag-version patch   # for bugfixes
            # OR npm version --no-git-tag-version minor  # for breaking changes
  [ ] 1.14 Commit with Conventional style:
            git commit -m "release: v0.X.Y

                - 33 adapters + Tool/Agent modes (if v0.1.0)
                - …other release highlights from CHANGELOG…"
  [ ] 1.15 Annotated tag:
            git tag -a v0.X.Y -m "release v0.X.Y — 1-line summary"

================================== 本地质量门到此结束 ==================================

  [ ] 2.1 Create the empty PUBLIC GitHub repo (if this is the v0.1.0 first push):
            - Visit https://github.com/new
            - Repository name: dsh-plugin-cli-hub
            - Visibility: Public
            - ☐ Add a README file   ← DO NOT CHECK
            - ☐ Add .gitignore      ← DO NOT CHECK
            - ☐ Choose a license    ← DO NOT CHECK
            - Click "Create repository"
            - Copy the SSH remote URL it shows (git@github.com:<YOU>/dsh-plugin-cli-hub.git)
  [ ] 2.2 Wire remote (skip if already set):
            git remote -v
            git remote add origin git@github.com:<YOU>/dsh-plugin-cli-hub.git
            # or:  git remote set-url origin git@github.com:<YOU>/dsh-plugin-cli-hub.git
  [ ] 2.3 Push branch + tags:
            git branch -M main
            git push -u origin main
            git push origin v0.X.Y
  [ ] 2.4 Apply GitHub Topics (CRITICAL for plugin-market discovery):
            - Open https://github.com/<YOU>/dsh-plugin-cli-hub
            - About section → click the ⚙️ gear next to "Topics"
            - Enter these EXACTLY (spaces separate topics):
                dsh-plugin   deepseek-harness   ai-cli   tools   agent   quota   adapter   cli   deepseek
            - Save.
  [ ] 2.5 Fill About metadata:
            - Description → copy-paste `description` field from package.json.
            - Website → repo homepage URL (or leave blank).
            - ✓ "Include in the GitHub Marketplace" → no-op, just tick if it's there.
  [ ] 2.6 Draft GitHub Release in the browser:
            - https://github.com/<YOU>/dsh-plugin-cli-hub/releases/new
            - Tag: v0.X.Y → Target: main
            - Release title: v0.X.Y
            - "Set as pre-release" ✓  (keep ticked for every v0.X.Y)
            - "Create a discussion..." (optional, if you have discussions enabled)
            - Release notes → copy the `## [0.X.Y]` section from CHANGELOG.md verbatim,
              including `### Added / Changed / Fixed / Known Issues`.
            - (do NOT attach binaries)
            - Click "Publish release".

================================ GitHub 端到此结束，开始 npm 发布 ================================

  [ ] 3.1 Double-check npm whoami:
            npm whoami
  [ ] 3.2 Dry-run first:
            pnpm publish --dry-run --access public
        → Tarball contents OK, no "name already exists / 403" errors.
  [ ] 3.3 Publish for real:
            pnpm publish --access public
  [ ] 3.4 Confirm:
            npm view dsh-plugin-cli-hub@0.X.Y
        → Prints package metadata; shows version 0.X.Y; `dist.tarball` URL is present.

  [ ] 3.5 (IF name was taken — only do this if step 3.2/3.3 fails with 403 "name")
            → See "Handling npm package-name collision" in §4 below, then redo 3.1–3.4
              with the scoped name.

================================ npm 端到此结束，开始发布后验收 ================================

  [ ] 4.1 Channel-B install smoke (GitHub):
            bash scripts/release-smoke-install.sh \
              --channels B --profile release-smoke-b \
              --gh-user <YOU> --version 0.X.Y
        → PASS.
  [ ] 4.2 Channel-C install smoke (npm):
            bash scripts/release-smoke-install.sh \
              --channels C --profile release-smoke-c \
              --npm-name dsh-plugin-cli-hub --version 0.X.Y
        → PASS.
  [ ] 4.3 Run end-to-end once on either profile:
            dsh --profile <one-used-above> cli-hub scan l3
        → Output includes at least 7 discovered CLIs and no errors.
  [ ] 4.4 Check the GitHub tag/release page in a private browser window
        → Everything renders (no 404). Tag exists, release notes show.
  [ ] 4.5 Check npm package page in private window:
        → https://www.npmjs.com/package/dsh-plugin-cli-hub
        → Description + README render correctly.

================================ 验证到此结束，开始曝光/推广 ===================================

  [ ] 5.1 (Recommended) Open a DSH "Show and tell" Discussion post:
            - https://github.com/deepseek-ai/deepseek-harness/discussions/categories/show-and-tell
            - Title: `[Plugin Release] dsh-plugin-cli-hub — reuse 33+ local AI CLIs as DSH Tools & Agents`
            - Body: one-paragraph pitch, install commands (all 3 channels),
              6-section feature list, link back to repo README, 2 screenshots.
            - Pin the reply pointing to the latest release tag so people find it quickly.
  [ ] 5.2 (Recommended) Submit a PR to the community directory dsh-market:
            - https://github.com/dsh-market/dsh-market
            - Create `plugins/dsh-plugin-cli-hub.json` following their template
              (id, name, repo, description, topics: ["dsh-plugin"], stars_at_submit: <N>,
               version: 0.X.Y, capabilities: ["tool","agent","quota","web-ui"],
               npm: "dsh-plugin-cli-hub").
            - This is optional because dsh-market auto-crawls the `dsh-plugin` topic,
              but a PR gets you listed ~3 days faster and sometimes with a featured badge.
  [ ] 5.3 (Optional, after > 50 stars) Submit to awesome-deepseek-harness:
            - https://github.com/0xsline/awesome-deepseek-harness — open PR adding
              `- [dsh-plugin-cli-hub](https://github.com/<YOU>/dsh-plugin-cli-hub)`
              in the "Plugins" section.
  [ ] 5.4 (Optional, after > 200 stars) Apply for "精选 / Featured" badge on
        deepseek-harness-plugin.com.
  [ ] 5.5 Check indexing over the next 3 days:
            [ ] http://dsh-plugins.top → search "cli-hub" / "quota"
            [ ] https://deepseek-harness-plugin.com/zh-CN/plugins/
            [ ] Install the dsh-market DSH plugin → search "cli-hub" inside DSH.

================================ POST-RELEASE 跟进 =========================================

  [ ] 6.1 Bump package.json version to `0.X.(Y+1)-dev` so nightly builds don't collide
        with the release you just pushed. Do NOT tag this.
  [ ] 6.2 If you used any temporary profiles:
            rm -rf ~/.dsh/profiles/release-smoke-{a,b,c}
  [ ] 6.3 Close all "shipped in v0.X.Y" GitHub Issues and comment with a link
        to the release.
  [ ] 6.4 Open a tracking ticket for the next release that copies this checklist.
```

---

## 2. Output checks (what "good" looks like)

### 2.1 `pnpm pack --dry-run` expected output

Look for these entries:

```
npm notice
=== Tarball Contents ===
…
LICENSE
README.md
README.en.md
THIRD_PARTY_NOTICES.md
package.json
cordis.patch.yml
bundle/index.yml
dist/index.cjs
dist/index.js
dist/src/index.d.ts
```

and **no** `tests/`, no `.github/`, no `scripts/*.mjs` (those are dev-only).
**Exception**: we don't currently filter `scripts/` out via `files` because
`RELEASE-PLAN.md / RELEASING.md` are still stored in root and `files` excludes
by omission only. If you see them in the pack output, remove them via `files`
negative patterns BEFORE publishing.

### 2.2 `bash scripts/release-smoke-install.sh` expected exit

```
== summary: PASS=12 FAIL=0 ==
>> 全部通过 ✅
```

---

## 3. Rollback plan (if something is broken)

- **Before `npm publish`**: nothing to undo — just delete the local tag, force-push
  to remove the GitHub tag, fix, redo.
- **After `npm publish`, before dsh-market crawls**:
  - Deprecate the broken version so users can't accidentally install it:
    ```bash
    npm deprecate dsh-plugin-cli-hub@0.X.Y \
      "known-broken release — please upgrade to 0.X.(Y+1)"
    ```
  - Publish a patch version within 1 hour (just bump the version, rebuild, minimal
    fix; don't bundle unrelated changes).
- **After crawled**: same as above plus post a DSH Discussion reply under your
  Show-and-tell pin, warning anyone who installed the buggy version.
- **Security hotfix**: follow `CONTRIBUTING.md → §7 Security` (private report →
  7/14/30-day window) and use GitHub's Security Advisory, which auto-generates
  a CVE-style entry.

---

## 4. Name-conflict / environment cookbooks

### 4.1 Handling npm package-name collision

Sometimes `dsh-plugin-cli-hub` is already taken on npm. Steps to resolve in under 5 minutes:

1. Pick a scoped name matching your npm username: `@<your-npm-username>/dsh-plugin-cli-hub`.
2. Edit `package.json`:
   ```json
   "name": "@your-npm-username/dsh-plugin-cli-hub",
   "publishConfig": { "access": "public" }
   ```
3. Edit `cordis.patch.yml` → change `insert[0].name` to the **exact same scoped name**.
   DSH resolves bundles by name, so they MUST match.
4. Edit `bundle/index.yml` → `use:` field to match.
5. Edit both `README.md` and `README.en.md` — every `dsh plugin add dsh-plugin-cli-hub`
   line must become `dsh plugin add npm:@your-npm-username/dsh-plugin-cli-hub`. (GitHub
   channel `dsh plugin add github:<you>/dsh-plugin-cli-hub` works unchanged.)
6. Add a line to the `[Unreleased]` section of CHANGELOG.md:
   ```
   ### Changed
   - npm package renamed to `@<you>/dsh-plugin-cli-hub` due to name collision.
   ```
7. Redo §1 quality gate, §2 push, §3 publish.

### 4.2 npm publish E401 E403 (not logged in)

```bash
npm login           # interactive
npm whoami          # should print your username
```

### 4.3 GitHub push "Permission denied (publickey)"

```bash
# Generate key if missing:
ssh-keygen -t ed25519 -C "<your-github-email>" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub   # paste at https://github.com/settings/keys
# Then test:
ssh -T git@github.com    # "Hi <you>! You've successfully authenticated"
```

### 4.4 `dsh plugin add` fails with "bundle cli-hub.core not found"

Usually one of:

- `cordis.patch.yml` `insert[0].name` ≠ package.json `name`. **Must be byte-identical.**
- `exports.require` / `exports.default` in package.json points to a file that
  `pnpm build` didn't actually write. Re-run `pnpm build` and check with `ls -la dist/`.
- `npm files:` accidentally excludes `cordis.patch.yml` or `bundle/index.yml`.
  Re-add them to package.json `files` array.

---

## 5. Post-release tracking dashboard

Check these **1 week** and **1 month** after every release. If numbers fall way short,
open a dedicated "growth" ticket — don't try to fix it by bundling unrelated code into
the next patch release.

| Metric | Healthy (1 wk) | Healthy (1 mo) | Action if missed |
|---|---|---|---|
| GitHub Stars | ≥ 30 | ≥ 150 | Publish blog post + README install-command review + awesome-list PR |
| npm weekly downloads | ≥ 20 | ≥ 100 | Check dsh-market indexing; verify all 3 install commands in README still work |
| Open GitHub Issues | ≤ 3 | ≤ 8 | Triage weekly; don't merge features until the backlog is down. |
| dsh-market featured / searchable | searchable | featured | PR to dsh-market plugins JSON; add topic tags if any are missing |
| Quota-warning related issues | 0 | ≤ 2 | Add native provider quota adapters for the top 3 most-installed CLIs that still use estimate |

*End of `RELEASING.md`.*
