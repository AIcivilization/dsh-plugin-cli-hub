# PR description

<!--
  🧹 Read the notes in this HTML comment before opening the PR, then tick the checklist item by item.
  PRs missing the checklist will be sent back for completion before review.
-->

## Change type (tick all that apply)

- [ ] 🐛 Bugfix (non-breaking, fixes a bug)
- [ ] ✨ Feature (non-breaking, adds a feature / adapter)
- [ ] 💥 Breaking Change (incompatible with existing usage) -> requires a separate "BREAKING:" section below
- [ ] 📝 Documentation (docs / README / changelog / CONTRIBUTING only)
- [ ] 🧪 Test (unit tests / smoke only)
- [ ] 🔧 CI / Tooling (GitHub Actions, scripts, configuration)

## What changed

<!--
  Briefly describe your changes. For adapter PRs, paste:
    - adapter id & name
    - fingerprint match output from show-quota.mjs (or at least `xx --version`)
    - the new capabilities table (one row per tool / agent)
-->

...

## Related issue / discussion (Closes #xx)

<!-- e.g. Closes #123 auto-closes the issue. Mention related PRs too. -->

...

## Breaking change details (required if applicable)

BREAKING: ...

---

## Self-check checklist

### Basic quality (**all required**)

- [ ] I ran `pnpm typecheck` locally: 0 errors.
- [ ] I ran `pnpm test` locally: all passing; added unit tests covering positive and error branches.
- [ ] I ran `pnpm build` locally: dist artifacts generated with reasonable sizes.
- [ ] I ran `node scripts/e2e-smoke.mjs` locally: no fatal errors (exit code != 1).

### If this adds / modifies an adapter (tick if applicable)

- [ ] The adapter definition is registered in `BUILTIN_ADAPTERS` inside `src/adapters/builtin/index.ts`.
- [ ] commandMapping uses the recommended `kind: 'argv'` (not the deprecated `kind: 'template'`).
- [ ] Tool mode exercised by at least one smoke script or unit test: `dsh cli-hub tool exec ...` returns normally.
- [ ] Agent mode (if declared): spawn argsTemplate manually exercised at least once through spawn + close.
- [ ] A row was added to the Supported AI CLIs table in README.md.
- [ ] An entry was added to CHANGELOG.md under `[Unreleased] -> Added`.

### If this is a breaking change

- [ ] A separate `## [Unreleased] -> BREAKING CHANGES` section was added to CHANGELOG.md.
- [ ] The version field was bumped to the next minor per the v0.x convention.

### Docs

- [ ] README.md and README.en.md updated in the corresponding sections.
- [ ] Config parameter changes -> reflected in the README Configuration section / config reference table.
- [ ] New API endpoint / new DSH CLI subcommand -> command examples added to the matching README section.
