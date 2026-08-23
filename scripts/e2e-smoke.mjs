#!/usr/bin/env node
/* =========================================================================
 * scripts/e2e-smoke.mjs — minimal end-to-end smoke test that never writes to ~/.dsh
 *
 * Coverage:
 *   [ ] P1-8 check: after apply() succeeds, ctx.cliHub is mounted + ToolGateway.syncRegistrations really calls ctx.tools.define
 *   [ ] Real Scanner L3 scan: actually scans the local PATH and hits ~/.local/bin/claude (Claude Code 2.1.235 / pro)
 *   [ ] AgentGateway end-to-end: fake scripts under /tmp simulate jsonrpc + line-based, verifying spawn/ready/send/recv/shutdown
 *
 * Run:  node scripts/e2e-smoke.mjs
 * =======================================================================*/
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn as cp_spawn } from 'node:child_process';

const ok = (k, s) => console.log(`\x1b[32m ✓ PASS\x1b[0m  ${k}${s ? ' — ' + s : ''}`);
const fail = (k, e) => { console.error(`\x1b[31m ✗ FAIL\x1b[0m  ${k}\n   ${String(e?.stack || e).split('\n').slice(0,4).join('\n   ')}`); process.exitCode = 1; };

// =============== 1. Load the plugin ===============
const DIST = path.resolve(process.cwd(), 'dist/index.js');
const PKG = await import(DIST);
const { apply, name, defineCliAdapter, webSubPlugin } = PKG;
console.log(`\n\x1b[1m[e2e] Loading plugin: ${name} from ${DIST}\x1b[0m`);

// =============== 2. Build a minimal Cordis context ===============
const mem = {};
const toolsCalls = [];   // records ctx.tools.define / defineTool / dispose calls
const ctx = {
  scope: 'e2e-smoke',
  // ---- storage.scoped ----
  storage: {
    scoped: {
      async get(k) { return mem[k]; },
      async set(k, v) { mem[k] = v; },
    },
  },
  // ---- logger ----
  logger: (scope) => ({
    debug: (...a) => process.env.VERBOSE && console.debug(`\x1b[2m[${scope}]\x1b[0m`, ...a),
    info:  (...a) => console.log(`\x1b[90m[${scope}]\x1b[0m`, ...a),
    warn:  (...a) => console.warn(`\x1b[33m[WARN ${scope}]\x1b[0m`, ...a),
    error: (...a) => console.error(`\x1b[31m[ERR ${scope}]\x1b[0m`, ...a),
  }),
  // ---- real subprocess execution (GatewayTool must use ctx.subprocess; Scanner/Quota fall back to node child_process, but we provide a real exec too) ----
  subprocess: {
    async exec(cmd, args, opts = {}) {
      return await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          try { child.kill('SIGKILL'); } catch {}
          resolve({ stdout, stderr, exitCode: null });
        }, opts.timeout ?? 15_000);
        let stdout = '', stderr = '';
        let child;
        try { child = cp_spawn(cmd, args, { stdio:['ignore','pipe','pipe'], env: process.env }); }
        catch (e) { clearTimeout(t); done=true; resolve({ stdout:'', stderr:e.message, exitCode:null }); return; }
        child.stdout?.on('data', d => stdout += d.toString('utf8'));
        child.stderr?.on('data', d => stderr += d.toString('utf8'));
        child.on('error', e => { if (done) return; done=true; clearTimeout(t); resolve({ stdout, stderr:e.message, exitCode:null }); });
        child.on('close', code => { if (done) return; done=true; clearTimeout(t); resolve({ stdout, stderr, exitCode: code }); });
      });
    },
  },
  // ---- ctx.tools: DSH's real tool registration entry point. Records every define call and returns a handle with dispose (we do not register for real) ----
  tools: {
    define(def) {
      toolsCalls.push({ action: 'define', name: def.name, description: def.description?.slice(0, 40) });
      return {
        dispose() { toolsCalls.push({ action: 'dispose', name: def.name }); },
      };
    },
  },
  // ---- events: minimal Cordis-style on/emit/off (no EventEmitter2; hand-rolled) ----
  _eventHandlers: new Map(),
  on(event, handler) {
    let arr = this._eventHandlers.get(event);
    if (!arr) { arr = new Set(); this._eventHandlers.set(event, arr); }
    arr.add(handler);
    return () => this.off(event, handler);
  },
  off(event, handler) { this._eventHandlers.get(event)?.delete(handler); },
  emit(event, payload) { for (const h of this._eventHandlers.get(event) ?? []) { try { h(payload); } catch {} } },
  // ---- ctx.set (duck-typed as Cordis ctx.set) ----
  _props: {},
  set(key, value) { this._props[key] = value; },
  get(key) { return this._props[key]; },
  // ---- ctx.plugin (sub-plugin mounting; used by the plugin entry) ----
  plugin: () => {
    // Simplified: when cliPlugin/webPlugin inside plugins are applied manually, real Cordis is not needed;
    // the fallback path in apply (checking whether ctx.plugin is callable) duck-types its way around automatically.
  },
};

// =============== 3. Apply the plugin ===============
console.log('\x1b[1m--- Phase 1: plugin assembly apply(ctx) ---\x1b[0m');
try {
  await apply(ctx);
  const svc = ctx.cliHub ?? ctx.get?.('cliHub');
  if (!svc) throw new Error('ctx.cliHub not mounted after apply(ctx)');
  ok('apply: ctx.cliHub mounted', `service shape = scan/registry/quota/tools/agents = ${!!svc.scan}/${!!svc.registry}/${!!svc.quota}/${!!svc.tools}/${!!svc.agents}`);
} catch (e) {
  fail('apply: plugin assembly', e);
  console.log('\n[e2e] assembly failed; aborting remaining steps');
  process.exit(1);
}
const cliHub = ctx.cliHub;

// =============== 4. Register a minimal fake adapter for the ToolGateway test + verify ctx.tools.define call recording ===============
console.log('\n\x1b[1m--- Phase 2: P1-8 ToolGateway registration via ctx.tools.define ---\x1b[0m');
try {
  const echoAdapter = defineCliAdapter({
    id: 'echo-smoke',
    name: 'Echo Smoke',
    description: 'echo tool for e2e, used to verify tools.define is really called',
    fingerprint: { commandNames: ['echo'] },
    capabilities: {
      tools: [{
        dshToolName: 'cli-hub:echo-smoke:say',
        description: 'Echoes the input back; e2e test',
        inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        commandMapping: { kind: 'template', template: 'echo {{message}}' },
        outputParser: 'stdout-text',
      }, {
        dshToolName: 'cli-hub:echo-smoke:reverse',
        description: 'Echoes the input reversed',
        inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        commandMapping: { kind: 'template', template: "bash -c 'echo {{message}} | rev'" },
        outputParser: 'stdout-text',
      }],
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
  cliHub.registry.register(echoAdapter);

  // build a ScanItem to trigger ToolGateway.syncRegistrations
  const item = {
    adapterId: 'echo-smoke',
    executablePath: '/bin/echo',
    commandName: 'echo',
    authState: 'authenticated',
    scannedDepth: 'l1',
  };
  await cliHub.tools.syncRegistrations([item]);
  const defineCount = toolsCalls.filter(c => c.action === 'define').length;
  if (defineCount === 0) throw new Error('ctx.tools.define was never called');
  ok(`tools.syncRegistrations: ctx.tools.define called ${defineCount} time(s)`,
      toolsCalls.map(c=>`${c.action}:${c.name}`).join(', '));
} catch (e) { fail('P1-8 ToolGateway registration', e); }

// =============== 5. Scanner L3 against the real local claude ===============
console.log('\n\x1b[1m--- Phase 3: real Scanner L3 over the local PATH (probing claude) ---\x1b[0m');
try {
  // make sure ~/.local/bin is on PATH (scan reads process.env.PATH, so export it here)
  const localBin = `${process.env.HOME}/.local/bin`;
  if (!process.env.PATH.split(':').includes(localBin)) process.env.PATH = localBin + ':' + process.env.PATH;

  const result = await cliHub.scan({ depth: 'l3', timeoutPerCmd: 10000 });
  const items = Array.isArray(result) ? result : (result?.items ?? []);
  const hit = items.find(i => i.adapterId === 'claude-code');
  if (!hit) {
    console.warn('   [warn] claude-code not found (current PATH: ' + process.env.PATH.split(':').slice(0,5).join(':') + ':...' + ')');
    fail('Scanner L3: discover claude-code', new Error('no hit; PATH may not include ~/.local/bin'));
  } else {
    const extras = [];
    if (hit.version) extras.push(`version=${hit.version}`);
    if (hit.authState) extras.push(`auth=${hit.authState}`);
    if (hit.metadata) extras.push(`metadataKeys=${Object.keys(hit.metadata).join(',')}`);
    ok(`Scanner L3: discovered claude-code @ ${hit.commandName}`, extras.join(' | '));
    if (hit.version) {
      const is2 = /^[23]\./.test(hit.version);
      is2 ? ok('Scanner version parsed and >= 2.x', hit.version) : fail('Scanner version parsing', new Error('unexpected version ' + hit.version));
    }
    if (hit.authState === 'authenticated') {
      ok('Scanner authState = authenticated (logged in)');
    } else {
      console.warn(`   [warn] authState = ${hit.authState}; the authCheck regex may need adjusting`);
    }
  }
} catch (e) { fail('Scanner L3 scan for claude', e); }

// =============== 6. AgentGateway end-to-end (temp fake scripts) ===============
console.log('\n\x1b[1m--- Phase 4: AgentGateway end-to-end (fake scripts simulating jsonrpc + line-based) ---\x1b[0m');
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-e2e-'));
console.log(`   tmpdir = ${tmpdir}`);
try {
  // ---- 6a. register two fake adapters ----
  const jsonrpcShim = path.join(tmpdir, 'fake-jsonrpc-agent.sh');
  fs.writeFileSync(jsonrpcShim, [
    '#!/bin/sh',
    '# simulate the stdio-jsonrpc protocol',
    "echo '{\"jsonrpc\":\"2.0\",\"method\":\"$/progress\",\"params\":{\"token\":\"banner\",\"value\":{\"kind\":\"begin\",\"message\":\"FAKE SERVER READY\"}}}'",
    "echo '__JSONRPC_READY__'",
    'while IFS= read -r LINE; do',
    '  [ -z "$LINE" ] && continue',
    '  REQ_ID=$(printf \'%s\' "$LINE" | sed -n \'s/.*"id":\\([0-9][0-9]*\\).*/\\1/p\')',
    '  printf \'{"jsonrpc":"2.0","id":%s,"result":{"capabilities":{"echo":true}}}\\n\' "${REQ_ID:-null}"',
    'done',
    '',
  ].join('\n'), { mode: 0o755 });

  const lineShim = path.join(tmpdir, 'fake-line-agent.sh');
  fs.writeFileSync(lineShim, [
    '#!/bin/sh',
    "printf 'Welcome to FAKE-SNOW v1.0\\n'",
    "printf 'snow> '",
    'while IFS= read -r L; do',
    '  printf "echo: %s\\n" "$L"',
    "  printf 'snow> '",
    'done',
    '',
  ].join('\n'), { mode: 0o755 });

  // ---- register the two agent-only adapters ----
  const jsonrpcAd = defineCliAdapter({
    id: 'e2e-jsonrpc',
    name: 'E2E JsonRpc',
    description: 'fake script',
    fingerprint: { commandNames: ['fake-jsonrpc-agent.sh'] },
    capabilities: {
      agent: {
        protocol: 'stdio-jsonrpc',
        spawn: { command: jsonrpcShim, argsTemplate: [], readyPattern: '__JSONRPC_READY__', exitCmd: null, env: {} },
      },
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
  const lineAd = defineCliAdapter({
    id: 'e2e-line',
    name: 'E2E Line',
    description: 'fake script',
    fingerprint: { commandNames: ['fake-line-agent.sh'] },
    capabilities: {
      agent: {
        protocol: 'line-based',
        spawn: { command: lineShim, argsTemplate: [], readyPattern: 'snow> ', exitCmd: '/exit', env: {} },
      },
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
  cliHub.registry.register(jsonrpcAd);
  cliHub.registry.register(lineAd);

  // ---- 6b. JsonRpc spawn + ready + request ----
  {
    const s = await cliHub.agents.spawn('e2e-jsonrpc', { timeoutMs: 10_000 });
    ok(`AgentGateway.spawn jsonrpc pid=${s.pid}`, `status=waiting-ready->${s.status}`);
    const resp = await s.request('tools/list', {}, 6000);
    // AgentGateway.request already unwraps; this is the parsed result body directly
    if (resp?.capabilities?.echo !== true) throw new Error('unexpected jsonrpc result: ' + JSON.stringify(resp));
    ok('AgentGateway jsonrpc: request -> routed by id and result parsed', JSON.stringify(resp));
    await s.shutdown();
    ok(`AgentGateway jsonrpc: graceful shutdown`, `exit=${s.exitCode ?? null} endedAt set=${!!s.endedAt}`);
  }

  // ---- 6c. Line-based spawn + send + recv ----
  {
    const s = await cliHub.agents.spawn('e2e-line', { timeoutMs: 10_000 });
    ok(`AgentGateway.spawn line-based pid=${s.pid}`);
    await s.send('hi line agent');
    // recv returns { line: string } (see gateway-agent.ts AgentSession.recv)
    const wrap = await s.recv(6000);
    const line = typeof wrap === 'object' ? (wrap?.line ?? '') : String(wrap);
    if (!String(line).includes('echo: hi line agent')) throw new Error('unexpected echo line: ' + JSON.stringify(wrap));
    ok('AgentGateway line-based: send → recv', String(line).trim());
    await s.shutdown();
    ok(`AgentGateway line-based: shutdown`, `endedAt set=${!!s.endedAt}`);
  }

  // ---- 6d. stopAll: spawn two at once, then confirm stopAll cleans up ----
  const sA = await cliHub.agents.spawn('e2e-line', { timeoutMs: 8000 });
  const sB = await cliHub.agents.spawn('e2e-jsonrpc', { timeoutMs: 8000 });
  const n = cliHub.agents.listSessions().length;
  ok('AgentGateway parallel session count = ' + n, 'expected = 2');
  if (n !== 2) fail('AgentGateway parallel session count', new Error('listSessions().length is ' + n + ', expected 2'));
  await cliHub.agents.stopAll();
  const remain = cliHub.agents.listSessions().length;
  remain === 0 ? ok('AgentGateway.stopAll cleanup', 'remaining sessions = 0') : fail('AgentGateway.stopAll cleanup', new Error(remain + ' remaining'));
} catch (e) { fail('AgentGateway end-to-end', e); }
finally {
  // make sure every spawned process is killed
  try { await cliHub.agents.stopAll(); } catch {}
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
}

// =============== 6b. Web UI mounting (Phase 5: settings registration / in-memory ui API / real toggles) ===============
console.log('\n\x1b[1m--- Phase 5: Web UI mounting (scanner display + adapter toggles) ---\x1b[0m');
{
  // inject a fake settings/clientPages ctx
  const fakeSettings = {};
  fakeSettings.registerSection = function (s) { fakeSettings.last = s; return s; };
  const ctx2 = ctx;
  ctx2.settings = fakeSettings;
  ctx2.clientPages = { register: (_p) => { ctx2._clientPageRegistered = true; } };
  ctx2.router = {
    get: (route, h) => ((ctx2._routesGet = ctx2._routesGet || []).push({ route, h })),
    post: (route, h) => ((ctx2._routesPost = ctx2._routesPost || []).push({ route, h })),
  };
  // web sub-plugin: apply the webSubPlugin captured on first import directly (avoids duplicate instantiation from cache-busting)
  try {
    if (webSubPlugin && typeof webSubPlugin.apply === 'function') {
      webSubPlugin.apply(ctx);
    } else {
      throw new Error('PKG.webSubPlugin missing (does src/index.ts export const webSubPlugin = webPlugin?)');
    }
  } catch (e) {
    fail('Web sub-plugin mounting', new Error('apply webPlugin failed: ' + (e?.message ?? String(e))));
  }

  // --- P5-1: settings.registerSection registered successfully with id=cli-hub ---
  if (!fakeSettings.last) fail('settings.registerSection call', new Error('registerSection was never called'));
  else {
    ok('Web UI: settings.registerSection registered', 'id=' + fakeSettings.last.id);
    if (fakeSettings.last.id !== 'cli-hub') fail('wrong section id', new Error(fakeSettings.last.id));
    const r = fakeSettings.last.render();
    Array.isArray(r && r.sections)
      ? ok('Web UI: settings.render produced a sections array', 'count=' + r.sections.length)
      : fail('settings.render', new Error('sections is not an array'));
  }

  // --- P5-2: ctx.router.get/post registered (HTTP API fallback path) ---
  const got = ctx2._routesGet || [];
  const post = ctx2._routesPost || [];
  const routes = got.concat(post);
  if (routes.length >= 5) ok('Web UI: HTTP routes registered', 'GET=' + got.length + ' POST=' + post.length + ' (covers dashboard/adapters/scan/sessions/action)');
  else fail('HTTP route registration', new Error('too few routes: ' + routes.length));

  // --- P5-3: in-memory ui API — dashboard/adapterRows include claude-code with correct version/auth ---
  const ui = ctx.cliHub.ui;
  if (!ui) fail('cliHub.ui in-memory API', new Error('missing'));
  else {
    const d = await ui.getDashboard();
    ok('Web UI: ui.getDashboard shape ok', 'adaptersTotal=' + d.adaptersTotal + ' sessionsCount=' + d.sessionsCount);
    if (d.adaptersTotal < 1) fail('dashboard adaptersTotal', new Error('is 0'));
    const adapters = await ui.getAdapterRows();
    const cc = adapters.find((x) => x.id === 'claude-code');
    if (!cc) fail('adapter row claude-code', new Error('not found'));
    else {
      ok('Web UI: adapter rows include claude-code', 'defaultEnabled=' + cc.defaultEnabled);
      if (typeof cc.enabled === 'boolean') ok('Web UI: adapter.enabled projects correctly', String(cc.enabled));
      else fail('adapter.enabled field', new Error('not a boolean'));
    }
    // scanner projection
    const rows = await ui.getScannerRows('l1');
    if (Array.isArray(rows)) ok('Web UI: getScannerRows returns an array', 'rows=' + rows.length);
    else fail('getScannerRows', new Error('not an array'));
    // dispatch really triggers the toggle
    const res = await ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: false });
    if (res && res.ok === true) ok('Web UI: dispatch(toggle-adapter -> disable)', String(res.message || ''));
    else fail('dispatch toggle disable', new Error(JSON.stringify(res)));
    // after disable, registry should be enabled=false
    const afterDisable = ctx.cliHub.registry && ctx.cliHub.registry.isEnabled && ctx.cliHub.registry.isEnabled('claude-code');
    if (afterDisable === false) ok('Web UI: disable -> registry enabled=false', 'persisted');
    else fail('registry state sync', new Error('enabled not false: ' + afterDisable));
    // restore
    await ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: true });
    if (ctx.cliHub.registry && ctx.cliHub.registry.isEnabled && ctx.cliHub.registry.isEnabled('claude-code') === true) ok('Web UI: re-enable ok', '');
    else fail('registry re-enable', new Error('state did not return to true'));
  }

  // --- P5-4: scanner projection contains no illegal undefined fields ---
  if (ctx.cliHub && ctx.cliHub.ui) {
    const allRows = await ctx.cliHub.ui.getScannerRows('l1');
    const serializable = !JSON.stringify(allRows).includes('undefined');
    if (serializable) ok('Web UI: scanner rows serializable (no leftover undefined fields)', '');
    else fail('serialization failed', new Error('JSON contains undefined fields'));
  } else {
    fail('Scanner serialization check', new Error('ui missing; skipped'));
  }

  // --- P5-5 (P2): new view functions getQuotaRows / getToolRows / getAdapterDetail ---
  if (ctx.cliHub && ctx.cliHub.ui) {
    const ui = ctx.cliHub.ui;
    // getQuotaRows
    const quotaRows = await ui.getQuotaRows();
    if (Array.isArray(quotaRows)) ok('Web UI: getQuotaRows returns an array', 'rows=' + quotaRows.length);
    else fail('getQuotaRows', new Error('not an array'));

    // getToolRows
    const toolRows = await ui.getToolRows();
    if (Array.isArray(toolRows)) ok('Web UI: getToolRows returns an array', 'rows=' + toolRows.length);
    else fail('getToolRows', new Error('not an array'));

    // getAdapterDetail
    const detail = await ui.getAdapterDetail('claude-code');
    if (detail && detail.id === 'claude-code') {
      ok('Web UI: getAdapterDetail shape ok', 'id=' + detail.id + ' hasTools=' + !!(detail.capabilities && detail.capabilities.tools) + ' hasAgent=' + !!(detail.capabilities && detail.capabilities.agent));
      // serialization check
      const s = JSON.stringify(detail);
      if (!s.includes('undefined')) ok('Web UI: adapterDetail serializable', '');
      else fail('adapterDetail serialization', new Error('contains undefined'));
    } else fail('getAdapterDetail', new Error('returned null or id mismatch'));
  }

  // --- P5-6 (P2): new HTTP endpoints /quota /tools /adapters/:id registered ---
  const allRoutes = (ctx2._routesGet || []).concat(ctx2._routesPost || []).map(r => r.route);
  const expectNew = [
    '/plugins/cli-hub/api/quota', '/cli-hub/api/quota',
    '/plugins/cli-hub/api/tools', '/cli-hub/api/tools',
    '/plugins/cli-hub/api/agents/spawn', '/cli-hub/api/agents/spawn',
    '/plugins/cli-hub/api/agents/send', '/cli-hub/api/agents/send',
    '/plugins/cli-hub/api/tools/exec', '/cli-hub/api/tools/exec',
    '/plugins/cli-hub/api/events', '/cli-hub/api/events',
  ];
  const missing = expectNew.filter(r => !allRoutes.includes(r));
  if (missing.length === 0) ok('Web UI: P2 new HTTP endpoints registered', 'count=' + expectNew.length);
  else fail('P2 endpoints missing', new Error('missing: ' + missing.join(', ')));

  // --- P5-7 (P2): dispatch the new actions (show-install-hint / adapter-detail / quota-refresh) ---
  if (ctx.cliHub && ctx.cliHub.ui) {
    const ui = ctx.cliHub.ui;
    // show-install-hint
    const hintRes = await ui.dispatch('show-install-hint', { adapterId: 'claude-code' });
    if (hintRes.ok && hintRes.message) ok('Web UI: dispatch(show-install-hint)', String(hintRes.message).slice(0, 60));
    else fail('show-install-hint', new Error(JSON.stringify(hintRes)));
    // adapter-detail via dispatch
    const detailRes = await ui.dispatch('adapter-detail', { adapterId: 'claude-code' });
    if (detailRes.ok && detailRes.data?.id === 'claude-code') ok('Web UI: dispatch(adapter-detail)', 'data.id=' + detailRes.data.id);
    else fail('adapter-detail via dispatch', new Error(JSON.stringify(detailRes)));
  }
}

// =============== 7. Summary ===============
process.exitCode = process.exitCode || 0;
console.log('\n\x1b[1m=== e2e finished ===\x1b[0m');
console.log(process.exitCode === 0
  ? '\x1b[32m All passed \u2705\x1b[0m'
  : '\x1b[31m Some checks failed, exit code = ' + process.exitCode + ' \u274c\x1b[0m');
