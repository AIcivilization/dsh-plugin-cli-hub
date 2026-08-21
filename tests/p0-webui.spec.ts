/**
 * p0-webui.spec — Web UI 子插件冒烟
 *
 * 覆盖：
 *   1) settings.registerSection 被正确调用 id=cli-hub；render.refresh 产出合法字段
 *   2) ui-action 事件 → dispatchUiAction 真实调用 cliHub.enable/disable/agents.stop
 *   3) settings/clientPages 都不存在，但有 ctx.http/ctx.router → GET adapters 返回 JSON
 *   4) 三条路径都没有时，cliHub.ui 内存 API 仍可用（getDashboard/dispatch）
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
  // 按 src/index.ts 的顺序造 cliHub（轻量版，不跑真实 scanner fork）
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
    // ui: 占位，web.apply 会真实覆盖它（先给个空壳让类型不报错）
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

  it('1) settings.registerSection 被调用(id=cli-hub)；refresh 字段没有 undefined 非法引用（installPath/displayName/agents.list 等）', async () => {
    let captured: any = null;
    ctx.settings = {
      registerSection: vi.fn((s: any) => { captured = s; }),
    };
    const { registry, cliHub, scanItemsStub } = await applyPluginChain(ctx);

    expect(ctx.settings.registerSection).toHaveBeenCalledTimes(1);
    expect(captured?.id).toBe('cli-hub');
    expect(typeof captured.render).toBe('function');

    // 加一条假 ScanItem，验证 projection 生成没有 undefined 崩溃
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
    // claude-code 是 builtin，确保它 registry 存在且 isEnabled=true（defaultEnabled）
    expect(registry.get('claude-code')).toBeTruthy();
    registrySetEnabledCompat(registry, 'claude-code', true);

    const out = captured.render();
    // 2 sections 存在（4 个）；refresh 执行时不 throw
    const { sections } = out;
    expect(sections.length >= 3).toBe(true);
    const scannerSection = sections.find((s: any) => s.title && s.title.includes('已发现'));
    const rows = await scannerSection.refresh({ depth: 'l3' });
    expect(Array.isArray(rows)).toBe(true);
    // 行字段校验（不存在 undefined installPath/displayName）
    const r = rows.find((x: any) => x.id === 'claude-code') || rows[0];
    expect(r).toBeTruthy();
    expect(typeof r.displayName).toBe('string');
    expect(r.displayName.length > 0).toBe(true);
    expect(r.executablePath).toBe(fakeItem.executablePath); // 注意：之前占位写的是 installPath，现在应修正为 executablePath
    expect(['success', 'warning', 'danger', 'muted']).toContain(r.authBadge?.color);
    expect(typeof r.enabled).toBe('boolean');
    expect(Array.isArray(r.capabilities)).toBe(true);
    expect(Array.isArray(r.actions)).toBe(true);
    // 不允许引用到 cliHub.agents.list（必须是 listSessions）
    const txt = JSON.stringify(r);
    expect(txt).not.toContain('undefined');
    // Agent section refresh 不 crash
    const agentSection = sections.find((s: any) => s.title && s.title.includes('Agent'));
    const agentRows = await agentSection.refresh();
    expect(Array.isArray(agentRows)).toBe(true);
    // 证明 agent.listSessions 真的被调用（说明已修掉之前占位 bug 的 agents.list()）
    expect(cliHub.agents.listSessions).toHaveBeenCalled();
  });

  it('2) 通过 cli-hub/ui-action 事件派发 toggle-adapter/agent-stop → 真实调用 cliHub.enable/disable/agents.stop', async () => {
    const listeners: Record<string, Function[]> = {};
    ctx.on = vi.fn((evt: string, cb: Function) => { (listeners[evt] = listeners[evt] ?? []).push(cb); });
    ctx.settings = { registerSection: vi.fn() };
    const { cliHub, registry } = await applyPluginChain(ctx);
    registry.register(makeAdapter('foo', { id: 'foo' }));

    const uiAction = ({ id, payload }: any) => {
      for (const cb of listeners['cli-hub/ui-action'] ?? []) cb({ id, payload });
    };
    // wait microtask（订阅是同步，但我们在 apply 时注册，直接能拿到）
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

  it('3) settings/clientPages 缺，但 ctx.http 存在 → 注册了 /plugins/cli-hub/api/adapters 等路由并能返回 JSON', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { cliHub, registry } = await applyPluginChain(ctx);
    registry.register(makeAdapter('bar', { id: 'bar', defaultEnabled: true }));
    expect(ctx.http.get).toHaveBeenCalled();
    // 找 dashboard / adapters 两个接口
    const adaptersRoute = routes.find((r) => r.route === '/plugins/cli-hub/api/adapters');
    expect(adaptersRoute).toBeTruthy();
    // 模拟调用：{ status().json() } 响应
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await adaptersRoute!.handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(Array.isArray(jsonArg)).toBe(true);
    const ids = new Set(jsonArg.map((x: any) => x.id));
    expect(ids.has('bar')).toBe(true);
    expect(ids.has('claude-code')).toBe(true); // builtin
  });

  it('4) 三条路径都缺 → 仍然挂出 cliHub.ui 内存 API（getDashboard/dispatch），作为兜底入口', async () => {
    // ctx 没有 settings/clientPages/http/router
    const { cliHub } = await applyPluginChain(ctx);
    expect(cliHub.ui).toBeTruthy();
    expect(typeof cliHub.ui.getDashboard).toBe('function');
    expect(typeof cliHub.ui.getAdapterRows).toBe('function');
    expect(typeof cliHub.ui.dispatch).toBe('function');

    // dispatch 走 toggle-adapter
    registrySetEnabledCompat(cliHub.registry, 'claude-code', true);
    const result = await cliHub.ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: false });
    expect(result?.ok).toBe(true);
    expect(cliHub.disable).toHaveBeenCalledWith('claude-code');

    // dashboard 基本结构
    const d = await cliHub.ui.getDashboard();
    expect(typeof d.adaptersTotal).toBe('number');
    expect(d.adaptersTotal).toBeGreaterThan(0);
    expect(typeof d.summary.total).toBe('number');
  });

  it('5) 投影纯函数：projectScannerRows / projectAdapterRows 边界 case（无 adapterId、auth=unauthenticated 追加 installHint action）', async () => {
    const { projectScannerRows, projectAdapterRows } = await import('../src/web/index');
    // 无 adapterId 的 scanner item（"looksLikeAiCli unmatched" 分支）
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
    // 未登录 + 有 installHint → show-install-hint action
    expect(rows[1].actions.some((a: any) => a.id === 'show-install-hint')).toBe(true);

    // projectAdapterRows: scanItems 长度不同不会污染默认值（discovered = false 正确）
    const defs = [
      { id: 'x', name: 'X', description: 'd', capabilities: { tools: [] }, fingerprint: { commandNames: ['x'] }, defaultEnabled: true },
      { id: 'y', name: 'Y', description: 'd', capabilities: { agent: { protocol: 'line-based', spawn: { command: 'y', argsTemplate: [] } } }, fingerprint: { commandNames: ['y'] }, installHint: 'install y' },
    ];
    const adapterRows = projectAdapterRows(defs as any, { registryEnabled: () => true, scanItems: [{ adapterId: 'x', executablePath: '', commandName: 'x', version: '1', authState: 'authenticated', scannedDepth: 'l3' } as any] });
    expect(adapterRows.find((r: any) => r.id === 'x')?.discovered).toBe(true);
    expect(adapterRows.find((r: any) => r.id === 'y')?.discovered).toBe(false);
    expect(adapterRows.find((r: any) => r.id === 'y')?.actions.some((a: any) => a.id === 'show-install-hint')).toBe(true); // y 未安装+有 hint
  });
});

// helper: 兼容 registry.setEnabled 签名
function registrySetEnabledCompat(registry: any, id: string, enabled: boolean) {
  if (registry && typeof registry.setEnabled === 'function') registry.setEnabled(id, enabled);
}
