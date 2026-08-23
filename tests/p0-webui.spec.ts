/**
 * p0-webui.spec — Web UI sub-plugin smoke tests
 *
 * Coverage:
 *   1) settings.registerSection is called with id=cli-hub; render.refresh produces valid fields
 *   2) ui-action event -> dispatchUiAction really calls cliHub.enable/disable/agents.stop
 *   3) settings/clientPages absent but ctx.http/ctx.router present -> GET adapters returns JSON
 *   4) when none of the three paths exist, the cliHub.ui in-memory API still works (getDashboard/dispatch)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

type AnyCtx = Record<string, any>;
type AdapterDef = any;

function makeAdapter(id: string, overrides: Partial<AdapterDef> = {}): AdapterDef {
  return {
    id, name: id.toUpperCase(), description: `Adapter ${id}`,
    fingerprint: { commandNames: [id] },
    capabilities: { tools: [{ dshToolName: `x:${id}:do`, description: 'x', inputSchema: { type: 'object' }, commandMapping: { kind: 'template', template: 'echo' }, outputParser: 'stdout-text' }] },
    quota: { method: { kind: 'unknown' } },
    defaultEnabled: true,
    ...overrides,
  };
}

async function applyPluginChain(context: AnyCtx, config: any = {}) {
  // build cliHub in the same order as src/index.ts (lightweight; no real scanner fork)
  const { createDefaultRegistry } = await import('../src/core/registry');
  const { loadBuiltinAdapters } = await import('../src/adapters/builtin');

  const mem: Record<string, any> = {};
  const scopedStorage = {
    async get(k: string) { return mem[k]; },
    async set(k: string, v: any) { mem[k] = v; },
  };

  const registry = createDefaultRegistry(context as any, { enabledOverrides: config.adapters?.enabledOverrides ?? {} });
  loadBuiltinAdapters(registry);

  const enabledOrig = registry.setEnabled.bind(registry);
  const enabledSpy = vi.fn((id, enabled) => enabledOrig(id, enabled));
  registry.setEnabled = enabledSpy as any;

  const scanItemsStub: any[] = [];
  const toolSpy = { syncRegistrations: vi.fn(async () => {}), unregisterForAdapter: vi.fn() };
  const agentSpy = {
    listSessions: vi.fn(() => []),
    stop: vi.fn(async () => true),
    stopAll: vi.fn(async () => {}),
  };
  const quotaSpy: any = {};

  const cliHub: any = {
    registry,
    scanner: { on: vi.fn() },
    quota: quotaSpy,
    tools: toolSpy,
    agents: agentSpy,
    async scan(_opts: any = {}) {
      return { scannedAt: Date.now(), depth: 'l3', items: scanItemsStub.slice(), summary: { total: 0, matched: 0, enabled: 0, authenticated: 0, quotaWarning: 0 } };
    },
    list(filter: any = {}) {
      return registry.listAdapters(filter);
    },
    enable: vi.fn((id) => registry.setEnabled(id, true)),
    disable: vi.fn((id) => registry.setEnabled(id, false)),
    // ui: placeholder; web.apply overwrites it for real (empty shell keeps types happy)
    ui: null as any,
  };
  (context as any).set = vi.fn((_k: string, v: any) => v);
  context.cliHub = cliHub;
  context.storage = { scoped: scopedStorage };

  const webMod = await import('../src/web/index');
  webMod.apply(context as any);

  return {
    cliHub, registry, toolSpy, agentSpy, enabledSpy, scanItemsStub,
    registrySet: (id: string, en: boolean) => registry.setEnabled(id, en),
  };
}

describe('Web UI (web plugin)', () => {
  let ctx: AnyCtx;

  beforeEach(() => {
    ctx = {
      logger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      on: vi.fn(),
    };
  });

  it('1) settings.registerSection is called (id=cli-hub); refresh fields contain no undefined/illegal references (installPath/displayName/agents.list etc.)', async () => {
    let captured: any = null;
    ctx.settings = {
      registerSection: vi.fn((s: any) => { captured = s; }),
    };
    const { registry, cliHub, scanItemsStub } = await applyPluginChain(ctx);

    expect(ctx.settings.registerSection).toHaveBeenCalledTimes(1);
    expect(captured?.id).toBe('cli-hub');
    expect(typeof captured.render).toBe('function');

    // add a fake ScanItem and verify projection generation does not crash on undefined
    const fakeItem: any = {
      adapterId: 'claude-code',
      executablePath: '/opt/bin/claude',
      commandName: 'claude',
      version: '2.1.235',
      authState: 'authenticated',
      scannedDepth: 'l3',
    };
    scanItemsStub.push(fakeItem);
    registry.register(makeAdapter('extra', { id: 'extra', fingerprint: { commandNames: ['extra-cli'] } }));
    // claude-code is builtin; ensure it exists in the registry and isEnabled=true (defaultEnabled)
    expect(registry.get('claude-code')).toBeTruthy();
    registrySetEnabledCompat(registry, 'claude-code', true);

    const out = captured.render();
    // sections exist (6 total); refresh must not throw
    const { sections } = out;
    expect(sections.length >= 3).toBe(true);
    const scannerSection = sections.find((s: any) => s.title && s.title.includes('Discovered AI CLIs'));
    const rows = await scannerSection.refresh({ depth: 'l3' });
    expect(Array.isArray(rows)).toBe(true);
    // row field validation (no undefined installPath/displayName)
    const r = rows.find((x: any) => x.id === 'claude-code') || rows[0];
    expect(r).toBeTruthy();
    expect(typeof r.displayName).toBe('string');
    expect(r.displayName.length > 0).toBe(true);
    expect(r.executablePath).toBe(fakeItem.executablePath); // note: an earlier placeholder used installPath; must be executablePath now
    expect(['success', 'warning', 'danger', 'muted']).toContain(r.authBadge?.color);
    expect(typeof r.enabled).toBe('boolean');
    expect(Array.isArray(r.capabilities)).toBe(true);
    expect(Array.isArray(r.actions)).toBe(true);
    // must not reference cliHub.agents.list (must be listSessions)
    const txt = JSON.stringify(r);
    expect(txt).not.toContain('undefined');
    // Agent section refresh does not crash
    const agentSection = sections.find((s: any) => s.title && s.title.includes('Agent'));
    const agentRows = await agentSection.refresh();
    expect(Array.isArray(agentRows)).toBe(true);
    // proves agent.listSessions is really called (the earlier agents.list() placeholder bug is fixed)
    expect(cliHub.agents.listSessions).toHaveBeenCalled();
  });

  it('2) dispatching toggle-adapter/agent-stop via the cli-hub/ui-action event -> really calls cliHub.enable/disable/agents.stop', async () => {
    const listeners: Record<string, Function[]> = {};
    ctx.on = vi.fn((evt: string, cb: Function) => { (listeners[evt] = listeners[evt] ?? []).push(cb); });
    ctx.settings = { registerSection: vi.fn() };
    const { cliHub, registry } = await applyPluginChain(ctx);
    registry.register(makeAdapter('foo', { id: 'foo' }));

    const uiAction = ({ id, payload }: any) => {
      for (const cb of listeners['cli-hub/ui-action'] ?? []) cb({ id, payload });
    };
    // wait a microtask (subscription is sync, registered during apply, so it is available already)
    await 0;

    uiAction({ id: 'toggle-adapter', payload: { adapterId: 'foo', enabled: false } });
    await new Promise((r) => setTimeout(r, 10));
    expect(cliHub.disable).toHaveBeenCalledWith('foo');

    uiAction({ id: 'toggle-adapter', payload: { adapterId: 'foo', enabled: true } });
    await new Promise((r) => setTimeout(r, 10));
    expect(cliHub.enable).toHaveBeenCalledWith('foo');

    uiAction({ id: 'agent-stop', payload: { adapterId: 'foo' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(cliHub.agents.stop).toHaveBeenCalledWith('foo');
  });

  it('3) settings/clientPages missing but ctx.http present -> /plugins/cli-hub/api/adapters routes registered and return JSON', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { cliHub, registry } = await applyPluginChain(ctx);
    registry.register(makeAdapter('bar', { id: 'bar', defaultEnabled: true }));
    expect(ctx.http.get).toHaveBeenCalled();
    // find the dashboard / adapters endpoints
    const adaptersRoute = routes.find((r) => r.route === '/plugins/cli-hub/api/adapters');
    expect(adaptersRoute).toBeTruthy();
    // simulate the call: { status().json() } response shape
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await adaptersRoute!.handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(Array.isArray(jsonArg)).toBe(true);
    const ids = new Set(jsonArg.map((x: any) => x.id));
    expect(ids.has('bar')).toBe(true);
    expect(ids.has('claude-code')).toBe(true); // builtin
  });

  it('4) all three paths missing -> the cliHub.ui in-memory API (getDashboard/dispatch) is still mounted as the fallback entry', async () => {
    // ctx has no settings/clientPages/http/router
    const { cliHub } = await applyPluginChain(ctx);
    expect(cliHub.ui).toBeTruthy();
    expect(typeof cliHub.ui.getDashboard).toBe('function');
    expect(typeof cliHub.ui.getAdapterRows).toBe('function');
    expect(typeof cliHub.ui.dispatch).toBe('function');

    // dispatch via toggle-adapter
    registrySetEnabledCompat(cliHub.registry, 'claude-code', true);
    const result = await cliHub.ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: false });
    expect(result?.ok).toBe(true);
    expect(cliHub.disable).toHaveBeenCalledWith('claude-code');

    // basic dashboard shape
    const d = await cliHub.ui.getDashboard();
    expect(typeof d.adaptersTotal).toBe('number');
    expect(d.adaptersTotal).toBeGreaterThan(0);
    expect(typeof d.summary.total).toBe('number');
  });

  it('5) projection pure functions: projectScannerRows / projectAdapterRows edge cases (no adapterId; auth=unauthenticated appends the installHint action)', async () => {
    const { projectScannerRows, projectAdapterRows } = await import('../src/web/index');
    // scanner item without adapterId (unmatched "looksLikeAiCli" branch)
    const raw: any[] = [
      { adapterId: null, executablePath: '/usr/bin/gpt-cli', commandName: 'gpt-cli', version: '1.0', authState: 'unknown', scannedDepth: 'l1' },
      { adapterId: 'snow-cli', executablePath: '/usr/bin/snow', commandName: 'snow', version: '0.3', authState: 'unauthenticated', authHint: 'please snow login', scannedDepth: 'l3' },
    ];
    const get = (id: string): any => id === 'snow-cli'
      ? { id, name: 'Snow CLI', description: 'Snow', fingerprint: { commandNames: ['snow'] }, capabilities: { agent: { protocol: 'line-based', spawn: { command: 'snow', argsTemplate: [] as any[] } } }, installHint: 'npm i -g snow-cli' }
      : undefined;
    const rows = projectScannerRows(raw as any, { registryGet: get, registryEnabled: () => false });
    expect(rows[0].id.startsWith('cmd:')).toBe(true); // fallback id
    expect(rows[0].displayName).toBe('gpt-cli');
    expect(rows[1].id).toBe('snow-cli');
    expect(rows[1].installHint).toBeTruthy();
    // unauthenticated + has installHint -> show-install-hint action
    expect(rows[1].actions.some((a: any) => a.id === 'show-install-hint')).toBe(true);

    // projectAdapterRows: differing scanItems lengths do not pollute defaults (discovered=false is correct)
    const defs = [
      { id: 'x', name: 'X', description: 'd', capabilities: { tools: [] }, fingerprint: { commandNames: ['x'] }, defaultEnabled: true },
      { id: 'y', name: 'Y', description: 'd', capabilities: { agent: { protocol: 'line-based', spawn: { command: 'y', argsTemplate: [] } } }, fingerprint: { commandNames: ['y'] }, installHint: 'install y' },
    ];
    const adapterRows = projectAdapterRows(defs as any, { registryEnabled: () => true, scanItems: [{ adapterId: 'x', executablePath: '', commandName: 'x', version: '1', authState: 'authenticated', scannedDepth: 'l3' } as any] });
    expect(adapterRows.find((r: any) => r.id === 'x')?.discovered).toBe(true);
    expect(adapterRows.find((r: any) => r.id === 'y')?.discovered).toBe(false);
    expect(adapterRows.find((r: any) => r.id === 'y')?.actions.some((a: any) => a.id === 'show-install-hint')).toBe(true); // y not installed + has hint
  });
});

// helper: tolerant of registry.setEnabled signature variants
function registrySetEnabledCompat(registry: any, id: string, enabled: boolean) {
  if (registry && typeof registry.setEnabled === 'function') registry.setEnabled(id, enabled);
}
