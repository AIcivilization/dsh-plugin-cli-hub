# Web UI (scanner data display + adapter toggles) implementation plan

## Repository Research
- Plugin architecture: dsh-plugin-cli-hub exposes its capabilities via `Cordis ctx.set('cliHub', service)`; sub-plugins mount `src/web/index.ts` (placeholder implementation) and `src/cli/index.ts` via `mountSubPlugin()`.
- Web integration mechanisms (the current placeholder has **two compatible paths**; both kept and enhanced):
  1. **Path A: `ctx.settings.registerSection`** — DSH settings-page card structure (render returns sections; each section carries refresh/enableToggle metadata). Suited for "configuration + lightweight status" panels.
  2. **Path B: `ctx.clientPages.register`** — a full client page (DSH provides a Vue/React render stack or a "server-driven component tree" protocol). Suited for business panels with standalone routes.
- **Existing backend capabilities** (`ctx.cliHub.*`):
  - `scan(opts)`: returns `ScanResult { scannedAt, depth, items[], summary }`. Dual-form arguments: `scan('l3')` / `scan({depth, timeoutPerCmd})`.
  - `list({onlyEnabled, mode})`: fetches the adapter definition list with id/name/description/fingerprint/capabilities/quota/defaultEnabled.
  - `enable(id)` / `disable(id)`: flips registry enabled state + persists to storage + emits `cli-hub/cli-enabled/disabled`; disable also calls `agentGateway.stop(id)` and `toolGateway.unregisterForAdapter(id)`.
  - `registry.isEnabled(id)`: enabled check.
  - `scanner.on('scan-progress')`: streaming progress `{done, total, latest}`.
  - `scanner.on('cli-detected')` / `quota.*` / `agent-*` events are all forwarded to the ctx bus via `anyCtx.emit`.
- Placeholder status ([src/web/index.ts](../../src/web/index.ts)):
  - `registerSection.render.refresh()` returns "discovered CLIs + Agent sessions"; field names are wrong: `i.installPath` should be `i.executablePath`, `i.displayName` does not exist; it calls the nonexistent `cliHub.agents.list()` (should be `listSessions()`). Latent runtime bugs not yet triggered (the environment lacks the settings interface).
- **Constraints**:
  - Do not lock in a specific UI stack for DSH settings/client pages; implement "minimum viable + two compatible paths" against whatever ctx interfaces the plugin can see.
  - No new frontend bundling dependencies for the plugin surface (no vite/React/Vue); DSH's client-side rendering resources come from the DSH runtime. The plugin only exposes **driving data** (server-driven component tree / async refresh schema / HTTP-like endpoints).
  - If DSH provides a "server-driven component tree" (common in cordis/DM-style backend UIs), implement it as component-tree JSON + backend action routing; if HTTP endpoints, go through ctx.http (or fall back when absent).
  - The current package.json has no frontend build dependencies (React/Vue/TSX). We **introduce no new dependencies** to keep the plugin lightweight.

## Files and Modules
- `src/web/index.ts` (**rewrite**): upgrades from "placeholder no-op" to "both paths really rendering + action write-back + event subscription". Outputs:
  - `settingsSection`: Scanner card (refresh, progress, depth switch) + Adapter card (list + toggle buttons + auth badges).
  - `clientPage`: route `/cli-hub` returning a server-driven component tree (Dashboard + tables + Switch + ActionButton), writing back enable/disable/scan through action ids.
  - If neither interface exists: degrade to `ctx.http` routes (`GET /plugins/cli-hub/api/scan`, `POST /plugins/cli-hub/api/adapters/:id/enable`, etc. — RESTful JSON APIs fetchable by any window outside DSH).
- `src/core/types.ts` (**minor edit**): add safe optional fields like `ScanItem.displayName / authHint / metadataKeys` (ScanItem has no displayName today, but panels need to show a name). Or skip the change and use projection functions inside web/index.ts (preferred; keeps the core contract lean).
- `src/index.ts` (**minor edit**): add two read-only view APIs to the cliHub aggregate service (`ui.getDashboardSnapshot()` / `ui.toggleAdapter(id, enabled)`) so frontend call assembly is not scattered; or leave it and have the web layer call existing APIs directly (preferred: keep the core facade stable).
- `tests/p0-webui.spec.ts` (**new**): construct a minimal ctx (with cliHub + settings/clientPages spies); after `apply(webPlugin)` assert that:
  1. `registerSection` was called and `id === 'cli-hub'`.
  2. `refresh()` output field names are correct (`executablePath`; `displayName` falls back to name, etc.) and no nonexistent functions are referenced.
  3. Simulating an enable/disable action click (or component-tree action id) indirectly calls `cliHub.enable/disable`.
  4. In the degraded RESTful branch (no settings/clientPages), ctx.http.route (or fallback path handlers) can return JSON.
- `scripts/e2e-smoke.mjs` (**minor edit**): add a "Phase 5 Web UI mounting" stage asserting webPlugin registers successfully and a UI snapshot JSON skeleton is obtainable.
- `README.md`: untouched, keeping the "no docs unless requested" rule.

## Implementation Steps (in dependency order)
### Step 1: extract a pure-function data projection layer in src/web/index.ts first (zero runtime dependencies)
- `projectScanItem(item: ScanItem, registryEnabled: (id)=>boolean): UiCliRow`
  - displayName: prefer `registry.get(item.adapterId)?.name`, else `item.commandName` (fixes earlier direct references to nonexistent `displayName/installPath` fields)
  - fields: id / name / commandName / executablePath / version / authBadge (authenticated=green, unauthenticated=yellow, unknown=gray, expired=red) / enabled / capabilities (tool/agent tags) / authHint
- `projectAdapters(adapters[], registryEnabled): UiAdapterRow[]` — includes adapters present in the registry even when undiscovered by the scanner (i.e. "potential/not installed" states are shown too).
- `projectSessions(sessions[]): UiSessionRow[]` — sessionId/adapterId/pid/status/durationMs/stopAction.
- **Verify**: project a claude-code ScanItem in unit tests -> fields correct.

### Step 2: make the settings path (registerSection) actually work
- Fix the placeholder's three runtime bugs:
  1. `i.installPath` → `i.executablePath`；
  2. `i.displayName` → `registry.get(i.adapterId)?.name ?? i.commandName`；
  3. `cliHub.agents.list()` → `cliHub.agents.listSessions()`。
- "Discovered AI CLIs" section:
  - `refresh(depth?)`: calls `cliHub.scan({depth, timeoutPerCmd})` -> returns card rows; add `availableActions: [{id:'cli-hub:rescan-l3', label:'Rescan (L3)', variant:'primary'}]`.
  - Each row carries `availableActions: [{id:'cli-hub:toggle', adapterId, variant:'toggle', value: enabled}]`; if `authState === 'unauthenticated'` append `{id:'cli-hub:open-install-hint', adapterId}`.
  - Table headers: name / path / version / auth / quota (reserved percent) / enable switch.
- "Adapter toggles (full list)" as a separate section:
  - `refresh()` -> `cliHub.list({onlyEnabled:false})` merged with version/auth from the latest lastScan; each row gets a toggle + capability tags.
  - Section-level availableActions: `['cli-hub:enable-all-authed', 'cli-hub:disable-all']`.
- "Agent sessions" section:
  - `source()` -> `cliHub.agents.listSessions()`; per-row action `cli-hub:agent-stop`.
  - Section-level action `cli-hub:agent-stop-all`.
- **Action handler**: if the settings spec supports section.onAction(actionId, payload) use it; otherwise emit ctx.emit('cli-hub/ui-action', {id, payload}), subscribe within web/apply and dispatch to cliHub.enable/disable/agents.stop/scan('l3') etc.

### Step 3: ClientPages path (register) — server-driven component tree
- If DSH's `clientPages.register` accepts `panel: { kind:'component-tree', root: {...} }` or similar semantics (when unknown, produce descriptive JSON plus a fallback):
  - Render structure (mirrors the settings page but with a standalone route):
    1. Dashboard (summary cards: total/matched/enabled/authenticated/warnings)
    2. Scan bar (depth dropdown + refresh button + progress bar)
    3. Adapter table (same as settings page 2 + toggles)
    4. Scanner discovery table (same as settings page 1)
    5. Agent session table (same as settings page 3)
  - Component-tree nodes post `actions: [{id, payload}]` back to the same route; web/apply subscribes to ctx route events internally or provides an action dispatcher.
- If DSH does not accept a component tree (the interface only understands builtin placeholders) do **not** force a contract change: keep the placeholder for now and expose real UI data through the degraded HTTP API below, so users on this path can still fetch everything from the frontend.

### Step 4: degraded HTTP API (when neither settings nor clientPages exists)
- Detect whether ctx.http (or ctx.router) provides `get/post`:
  - `GET /plugins/cli-hub/api/scan?depth=l3` -> `ScanResult` JSON.
  - `GET /plugins/cli-hub/api/adapters` -> `UiAdapterRow[]` (with enabled; projected and merged with lastScan).
  - `POST /plugins/cli-hub/api/adapters/:id/enable` (body: `{enabled: boolean}`) -> calls cliHub.enable/disable, returns `{ok:true}`.
  - `GET /plugins/cli-hub/api/agents/sessions` → `UiSessionRow[]`。
  - `POST /plugins/cli-hub/api/agents/:adapterId/stop` → `{ok:true}`。
  - `GET /plugins/cli-hub/api/dashboard` — aggregate view (ScanResult.summary + adapter totals/enabled counts + session count).
- If no HTTP API either: degrade to exporting **in-memory API functions** for the CLI debug subcommands (`npx cli-hub ui dashboard`), so the UI entry never fully breaks.

### Step 5: event subscription (live refresh)
- Within web/apply subscribe to the forwarded events on ctx (forwarded in step 7):
  - `cli-hub/scan-progress` -> push if settings/clientPages offer a `pushUpdate` interface; otherwise take effect naturally at next refresh + record into an in-memory ring buffer (max 50 entries) for polling via HTTP `GET /plugins/cli-hub/api/scan/progress`.
  - `cli-hub/cli-enabled/disabled` -> same.
  - `cli-hub/agent-*` -> refresh the sessions table.

### Step 6: tests & regression
- `tests/p0-webui.spec.ts` (vitest):
  1. apply webPlugin + mock settings.registerSection; capture the section, call section.render.refresh() -> assert the returned structure references no undefined fields and the row count aligns with scanner input.
  2. emit `ui-action('cli-hub:toggle', {id:'x', enabled:false})` -> spy asserts cliHub.disable('x') called once.
  3. mock a scenario without settings/clientPages but with ctx.http; after apply trigger `GET /plugins/cli-hub/api/adapters` -> returns JSON.
- Run the trio green: `pnpm vitest run` + `pnpm build` + `node scripts/e2e-smoke.mjs` (Phase 5 already added).

## Dependencies and Considerations
- **DSH interface unknown**: the real fields of settings/clientPages (settingsSection's action field names / the format clientPages panels accept) are unknown. Strategy:
  - Fill per the placeholder conventions first (section.refresh + row availableActions + id='cli-hub:*'); extra fields are harmless, and if DSH ignores them at runtime we fall back to the HTTP API — at least one of the three layers works.
  - Add no frontend dependencies and no bundling (avoid breaking pnpm build's existing dual-format output).
- **Concurrency/permissions**: enable/disable writes storage + emits events + may kill agent processes; every action is idempotent (double enable is fine — the registry handles idempotency itself).
- **Field compatibility**: do not add a displayName field to `ScanItem` (don't break published types); the UI layer uses a projection function falling back to `registry.get(id)?.name`.
- **Injection declaration**: web.ts declares `inject.required: ['cliHub']`; if DSH's injection system is not standard Cordis inject (just duck-typing), fall back to a check at the top of web/apply: `if (!ctx.cliHub) throw`. The current placeholder already reads `(ctx as any).cliHub` directly — unchanged.

## Validation
1. `pnpm vitest run tests/p0.spec.ts tests/p0-agent.spec.ts tests/p0-webui.spec.ts` all green.
2. `pnpm build` error-free; types via `tsc --noEmit` (or the build's built-in emit) add 0 new warnings.
3. `node scripts/e2e-smoke.mjs` Phases 1-5 stay green; new Phase 5 assertions:
   - webPlugin registers successfully (settings.registerSection called).
   - one dashboard snapshot call -> returns `summary.total >= 1` (at least one builtin adapter).
   - at least one projected adapter row has `id === 'claude-code'` with correct version/auth.
4. (optional/manual) after running install-to-dsh-web.sh, visit http://127.0.0.1:3080/ -> the sidebar shows "CLI Hub" with the scanner table + toggle buttons; disabling claude-code really calls ctx.cliHub.disable and triggers agent-stop.

## Risks
- **High risk: DSH settings/clientPages action protocol unknown; clicks do nothing** -> mitigation:
  - provide action ids at the component-tree/section layer; simultaneously hook the ctx event bus subscription (`cli-hub/ui-action`) + degraded HTTP — two channels so the frontend can at least POST.
  - note near the top of web/index.ts: "if DSH's settings action callback name is not XXXX, replace XXX; or just use the REST API."

- **Medium risk: ctx.http route prefix differs (DSH may mount `/api/` instead of `/plugins/`)** -> mitigation:
  - register both prefixes up front: `/cli-hub/*` + `/plugins/cli-hub/*`.
  - without ctx.http, return memory functions (`cliHub.ui = { getDashboardSnapshot, dispatchAction }`) for CLI/other plugins to call.
- **Low risk: large scanner row counts block refresh on the UI** -> mitigation:
  - refresh defaults to last scan results + triggers a fresh scan in the background; scan-progress events push incremental updates.
  - expose a `returnCached=true` parameter on `GET /scan` (default true) returning cached results first.
- **Low risk: enable/disable + storage persistence conflict in multi-user DSH** -> mitigation: scopedStorage currently uses the DSH scope and the plugin already reuses ctx.storage.scoped; if DSH later adds per-user scopes, only the storage layer needs splitting — the UI layer stays unchanged.
