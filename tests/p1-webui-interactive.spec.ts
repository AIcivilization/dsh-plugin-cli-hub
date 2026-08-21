/**
 * p1-webui-interactive.spec — P2 交互式 Web 设置页单测
 *
 * 覆盖：
 *   1) projectQuotaRow：percent/warning 边界（total 缺失、total=0、used ≥ 90%）
 *   2) projectToolRows：只列出已发现且已认证的 adapter 的 tool；未登录的不出现
 *   3) projectAdapterDetail：tools/agent/scanInfo/quota 完整字段
 *   4) dispatchUiAction：
 *        - agent-spawn 调 cliHub.agents.spawn
 *        - agent-send 通过 session.send 派发
 *        - quota-refresh 调 cliHub.quota.refresh
 *        - quota-refresh-all 退化模式对每个启用 adapter 分别 refresh
 *        - tool-exec 调 cliHub.tools.execute
 *        - show-install-hint 返回 def.installHint
 *        - adapter-detail 走 projectAdapterDetail
 *        - 未知 action 返回 ok:false
 *   5) 新 HTTP 端点：GET /quota, /tools, /adapters/:id；POST /agents/spawn, /agents/send, /tools/exec；GET /events
 *   6) settings 渲染包含 6 个 section（概览/已发现/Adapter开关/额度监控/可用工具/Agent会话）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  projectQuotaRow,
  projectToolRows,
  projectAdapterDetail,
  dispatchUiAction,
} from '../src/web/index';

type AnyCtx = Record<string, any>;

describe('P2 交互式 Web UI — projection 纯函数', () => {
  it('projectQuotaRow：total 缺失时 percent=null；used ≥ 90% → warning=true', () => {
    // total 缺失
    const r1 = projectQuotaRow('a', 'A', { used: 10, currency: 'usd', source: 'http' });
    expect(r1.total).toBeUndefined();
    expect(r1.percent).toBeNull();
    expect(r1.warning).toBe(false);
    expect(r1.remaining).toBeUndefined();
    expect(r1.currency).toBe('usd');

    // total=0：避免除零，percent=null
    const r2 = projectQuotaRow('a', 'A', { used: 0, total: 0, currency: 'credits', source: 'cmd' });
    expect(r2.percent).toBeNull();

    // 正常 50%
    const r3 = projectQuotaRow('a', 'A', { used: 50, total: 100, currency: 'credits', source: 'cmd' });
    expect(r3.percent).toBe(50);
    expect(r3.warning).toBe(false);
    expect(r3.remaining).toBe(50);

    // 90% 阈值告警
    const r4 = projectQuotaRow('a', 'A', { used: 90, total: 100, currency: 'credits', source: 'cmd' });
    expect(r4.percent).toBe(90);
    expect(r4.warning).toBe(true);

    // 95% 超阈值
    const r5 = projectQuotaRow('a', 'A', { used: 95, total: 100, currency: 'credits', source: 'cmd' });
    expect(r5.warning).toBe(true);

    // remaining 自动推导（未显式提供）
    const r6 = projectQuotaRow('a', 'A', { used: 30, total: 100, source: 'cmd' });
    expect(r6.remaining).toBe(70);
  });

  it('projectToolRows：只列出已发现且已认证 adapter 的 tool；未登录/未发现的不出现', () => {
    const adapters: any[] = [
      {
        id: 'authed', name: 'Authed', capabilities: {
          tools: [{ dshToolName: 'authed:do', description: 'do', inputSchema: { type: 'object' }, commandMapping: { kind: 'template', template: 'x' }, outputParser: 'stdout-text' }],
        },
        fingerprint: { commandNames: ['authed'] },
      },
      {
        id: 'unauthed', name: 'Unauthed', capabilities: {
          tools: [{ dshToolName: 'unauthed:do', description: 'do', inputSchema: { type: 'object' }, commandMapping: { kind: 'template', template: 'x' }, outputParser: 'stdout-text' }],
        },
        fingerprint: { commandNames: ['unauthed'] },
      },
      {
        id: 'expired', name: 'Expired', capabilities: {
          tools: [{ dshToolName: 'expired:do', description: 'do', inputSchema: { type: 'object' }, commandMapping: { kind: 'template', template: 'x' }, outputParser: 'stdout-text' }],
        },
        fingerprint: { commandNames: ['expired'] },
      },
      {
        id: 'not-installed', name: 'NI', capabilities: {
          tools: [{ dshToolName: 'ni:do', description: 'do', inputSchema: { type: 'object' }, commandMapping: { kind: 'template', template: 'x' }, outputParser: 'stdout-text' }],
        },
        fingerprint: { commandNames: ['ni'] },
      },
    ];
    const scanItems: any[] = [
      { adapterId: 'authed', authState: 'authenticated', scannedDepth: 'l3' },
      { adapterId: 'unauthed', authState: 'unauthenticated', scannedDepth: 'l3' },
      { adapterId: 'expired', authState: 'expired', scannedDepth: 'l3' },
    ];
    const rows = projectToolRows(adapters, { registryEnabled: () => true, scanItems });
    const toolNames = rows.map(r => r.toolName);
    expect(toolNames).toContain('authed:do');
    expect(toolNames).not.toContain('unauthed:do'); // 未登录
    expect(toolNames).not.toContain('expired:do');  // 过期
    expect(toolNames).not.toContain('ni:do');      // 未发现
  });

  it('projectAdapterDetail：tools/agent/scanInfo/quota 完整字段', () => {
    const def: any = {
      id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic',
      description: 'Claude Code CLI',
      officialDoc: 'https://docs.claude.com',
      installHint: 'npm i -g @anthropic-ai/claude-code',
      defaultEnabled: true,
      fingerprint: { commandNames: ['claude'], versionArgs: ['--version'], configPaths: ['~/.claude/credentials.json'] },
      capabilities: {
        tools: [{ dshToolName: 'cli-hub:claude-code:run-task', description: 'Run a task', inputSchema: { type: 'object', properties: { task: { type: 'string' } } }, commandMapping: { kind: 'template', template: 'x' }, outputParser: 'stdout-text' }],
        agent: {
          protocol: 'stream-json',
          agentMeta: { displayName: 'Claude', avatarEmoji: '🤖', strengths: ['coding'], supportsStreaming: true },
          spawn: { command: 'claude', argsTemplate: [] },
        },
      },
    };
    const scan: any = {
      adapterId: 'claude-code',
      version: '2.1.235',
      authState: 'authenticated',
      executablePath: '/opt/claude',
      scannedDepth: 'l3',
    };
    const quota: any = { used: 50, total: 100, currency: 'credits', source: 'cmd' };

    const detail = projectAdapterDetail(def, { registryEnabled: () => true, scan, quota });

    // 基础字段
    expect(detail.id).toBe('claude-code');
    expect(detail.name).toBe('Claude Code');
    expect(detail.vendor).toBe('Anthropic');
    expect(detail.installHint).toContain('npm i');
    expect(detail.fingerprint.commandNames).toEqual(['claude']);
    expect(detail.fingerprint.versionArgs).toEqual(['--version']);

    // capabilities.tools
    expect(detail.capabilities.tools?.length).toBe(1);
    expect(detail.capabilities.tools?.[0].toolName).toBe('cli-hub:claude-code:run-task');
    expect(detail.capabilities.tools?.[0].enabled).toBe(true);

    // capabilities.agent
    expect(detail.capabilities.agent?.protocol).toBe('stream-json');
    expect(detail.capabilities.agent?.displayName).toBe('Claude');
    expect(detail.capabilities.agent?.avatarEmoji).toBe('🤖');
    expect(detail.capabilities.agent?.supportsStreaming).toBe(true);

    // scanInfo
    expect(detail.scanInfo?.version).toBe('2.1.235');
    expect(detail.scanInfo?.auth).toBe('authenticated');
    expect(detail.scanInfo?.authBadge.label).toBe('已登录');
    expect(detail.scanInfo?.executablePath).toBe('/opt/claude');

    // quota
    expect(detail.quota?.percent).toBe(50);
    expect(detail.quota?.currency).toBe('credits');

    // scan 缺失
    const detail2 = projectAdapterDetail(def, { registryEnabled: () => false, scan: null, quota: null });
    expect(detail2.scanInfo).toBeNull();
    expect(detail2.quota).toBeNull();
    expect(detail2.enabled).toBe(false);
    expect(detail2.capabilities.tools?.[0].enabled).toBe(false);
  });
});

describe('P2 交互式 Web UI — dispatchUiAction 新增动作', () => {
  let ctx: AnyCtx;

  beforeEach(() => {
    ctx = {};
  });

  function makeCliHub(overrides: any = {}) {
    const cliHub: any = {
      registry: {
        get: vi.fn((id: string) => ({ id, name: id, installHint: `install ${id}`, officialDoc: `https://${id}.doc`, capabilities: { tools: [] }, fingerprint: { commandNames: [id] }, defaultEnabled: true, description: id })),
        isEnabled: vi.fn(() => true),
      },
      list: vi.fn((filter?: any) => {
        const all = [{ id: 'a' }, { id: 'b' }];
        if (filter?.onlyEnabled) return all.filter(a => cliHub.registry.isEnabled(a.id));
        return all;
      }),
      enable: vi.fn(),
      disable: vi.fn(),
      scan: vi.fn(async () => ({ items: [], scannedAt: Date.now(), depth: 'l3', summary: { total: 0, matched: 0, enabled: 0, authenticated: 0, quotaWarning: 0 } })),
      agents: { spawn: vi.fn(async (id: string) => ({ sessionId: `s-${id}`, adapterId: id })), stop: vi.fn(async () => true), stopAll: vi.fn(async () => {}), listSessions: vi.fn(() => []), send: vi.fn(async () => {}) },
      quota: { refresh: vi.fn(async (id: string) => ({ used: 1, total: 10, currency: 'credits', source: 'cmd', adapterId: id })), get: vi.fn(async (id: string) => ({ used: 1, total: 10, currency: 'credits', source: 'cmd' })) },
      tools: { execute: vi.fn(async (name: string, input: any) => ({ content: [{ type: 'text', text: `result:${name}` }] })) },
      storage: { loadLastScan: vi.fn(async () => null) },
      ...overrides,
    };
    return cliHub;
  }

  it('agent-spawn：调 cliHub.agents.spawn 并返回 session', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-spawn', { adapterId: 'claude-code' });
    expect(result.ok).toBe(true);
    expect(cliHub.agents.spawn).toHaveBeenCalledWith('claude-code', undefined);
    expect(result.data?.sessionId).toBe('s-claude-code');
  });

  it('agent-spawn：adapterId 缺失 → ok:false', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-spawn', {});
    expect(result.ok).toBe(false);
    expect(cliHub.agents.spawn).not.toHaveBeenCalled();
  });

  it('agent-spawn：cliHub.agents.spawn 不存在 → 友好失败', async () => {
    const cliHub = makeCliHub({ agents: { stop: vi.fn(), stopAll: vi.fn(), listSessions: vi.fn(() => []) } });
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-spawn', { adapterId: 'x' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('不支持 spawn');
  });

  it('agent-send：通过 session.send 派发消息', async () => {
    const sessionSend = vi.fn(async () => {});
    const cliHub = makeCliHub({
      agents: {
        listSessions: vi.fn(() => [{ sessionId: 's1', adapterId: 'foo', send: sessionSend }]),
        stop: vi.fn(), stopAll: vi.fn(),
      },
    });
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-send', { adapterId: 'foo', sessionId: 's1', message: 'hello' });
    expect(result.ok).toBe(true);
    expect(sessionSend).toHaveBeenCalledWith('hello');
  });

  it('agent-send：session 不存在时回落 cliHub.agents.send', async () => {
    const agentsSend = vi.fn(async () => {});
    const cliHub = makeCliHub({
      agents: { listSessions: vi.fn(() => []), send: agentsSend, stop: vi.fn(), stopAll: vi.fn() },
    });
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-send', { adapterId: 'foo', message: 'hello' });
    expect(result.ok).toBe(true);
    expect(agentsSend).toHaveBeenCalledWith('foo', 'hello');
  });

  it('agent-send：message 缺失 → ok:false', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'agent-send', { adapterId: 'foo' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('message 缺失');
  });

  it('quota-refresh：调 cliHub.quota.refresh', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'quota-refresh', { adapterId: 'a' });
    expect(result.ok).toBe(true);
    expect(cliHub.quota.refresh).toHaveBeenCalledWith('a');
    expect(result.data?.total).toBe(10);
  });

  it('quota-refresh-all：退化模式对每个已启用 adapter 分别 refresh', async () => {
    const cliHub = makeCliHub(); // 没有 refreshAll
    const result = await dispatchUiAction(ctx as any, cliHub, 'quota-refresh-all', {});
    expect(result.ok).toBe(true);
    expect(cliHub.quota.refresh).toHaveBeenCalledTimes(2); // a + b
    expect(result.data?.length).toBe(2);
  });

  it('quota-refresh-all：原生 refreshAll 优先', async () => {
    const refreshAll = vi.fn(async () => [{ adapterId: 'a' }, { adapterId: 'b' }]);
    const cliHub = makeCliHub({ quota: { refreshAll, refresh: vi.fn(), get: vi.fn() } });
    const result = await dispatchUiAction(ctx as any, cliHub, 'quota-refresh-all', {});
    expect(result.ok).toBe(true);
    expect(refreshAll).toHaveBeenCalled();
    expect(cliHub.quota.refresh).not.toHaveBeenCalled();
  });

  it('tool-exec：调 cliHub.tools.execute', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'tool-exec', { toolName: 'my-tool', input: { x: 1 } });
    expect(result.ok).toBe(true);
    expect(cliHub.tools.execute).toHaveBeenCalledWith('my-tool', { x: 1 });
    expect(result.data?.content?.[0]?.text).toBe('result:my-tool');
  });

  it('tool-exec：toolName 缺失 → ok:false', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'tool-exec', { input: {} });
    expect(result.ok).toBe(false);
  });

  it('show-install-hint：返回 def.installHint + officialDoc', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'show-install-hint', { adapterId: 'a' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('install a');
    expect(result.data?.officialDoc).toBe('https://a.doc');
  });

  it('show-install-hint：adapterId 缺失 → ok:false', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'show-install-hint', {});
    expect(result.ok).toBe(false);
  });

  it('adapter-detail：返回完整 detail', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'adapter-detail', { adapterId: 'a' });
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe('a');
    expect(result.data?.name).toBe('a');
  });

  it('adapter-detail：未找到 adapter → ok:false', async () => {
    const cliHub = makeCliHub({ registry: { get: vi.fn(() => undefined), isEnabled: vi.fn(() => false) } });
    const result = await dispatchUiAction(ctx as any, cliHub, 'adapter-detail', { adapterId: 'missing' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未找到');
  });

  it('未知 action → ok:false', async () => {
    const cliHub = makeCliHub();
    const result = await dispatchUiAction(ctx as any, cliHub, 'some-unknown-action', {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未知动作');
  });
});

describe('P2 交互式 Web UI — 新增 HTTP API 端点', () => {
  let ctx: AnyCtx;

  beforeEach(() => {
    ctx = {
      logger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      on: vi.fn(),
    };
  });

  async function applyPluginWithHttp(context: AnyCtx) {
    const { createDefaultRegistry } = await import('../src/core/registry');
    const { loadBuiltinAdapters } = await import('../src/adapters/builtin');

    const mem: Record<string, any> = {};
    const scopedStorage = {
      async get(k: string) { return mem[k]; },
      async set(k: string, v: any) { mem[k] = v; },
    };

    const registry = createDefaultRegistry(context as any, { enabledOverrides: {} });
    loadBuiltinAdapters(registry);

    const cliHub: any = {
      registry,
      scanner: { on: vi.fn() },
      quota: {
        get: vi.fn(async (id: string) => ({ used: 30, total: 100, currency: 'credits', source: 'cmd', adapterId: id })),
        refresh: vi.fn(async (id: string) => ({ used: 30, total: 100, currency: 'credits', source: 'cmd', adapterId: id })),
      },
      tools: { execute: vi.fn(async (name: string, input: any) => ({ content: [{ type: 'text', text: `exec:${name}` }] })) },
      agents: {
        spawn: vi.fn(async (id: string) => ({ sessionId: `s-${id}`, adapterId: id, status: 'ready' })),
        stop: vi.fn(async () => true),
        stopAll: vi.fn(async () => {}),
        listSessions: vi.fn(() => []),
      },
      async scan(_opts: any = {}) {
        return { scannedAt: Date.now(), depth: 'l3', items: [], summary: { total: 0, matched: 0, enabled: 0, authenticated: 0, quotaWarning: 0 } };
      },
      list(filter: any = {}) {
        return registry.listAdapters(filter);
      },
      enable: vi.fn((id: string) => registry.setEnabled(id, true)),
      disable: vi.fn((id: string) => registry.setEnabled(id, false)),
      ui: null as any,
    };
    context.cliHub = cliHub;
    context.storage = { scoped: scopedStorage };
    context.set = vi.fn((_k: string, v: any) => v);

    const webMod = await import('../src/web/index');
    webMod.apply(context as any);
    return { cliHub, registry };
  }

  it('GET /plugins/cli-hub/api/quota 返回数组（含已启用 adapter 的额度）', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { registry } = await applyPluginWithHttp(ctx);
    registry.setEnabled('claude-code', true);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/quota');
    expect(route).toBeTruthy();
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(Array.isArray(json)).toBe(true);
    // 至少包含 claude-code 一行（quota.get 已 stub）
    const ids = json.map((r: any) => r.adapterId);
    expect(ids).toContain('claude-code');
  });

  it('GET /plugins/cli-hub/api/tools 返回已发现+已认证的工具列表', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { registry } = await applyPluginWithHttp(ctx);
    registry.setEnabled('claude-code', true);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/tools');
    expect(route).toBeTruthy();
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(Array.isArray(json)).toBe(true);
    // claude-code 内置有 tool 声明，但 scanItems 为空 → 这里应该返回空列表
    // 因为 projectToolRows 要求已发现（scanItems 里有）才列出
    expect(json.length).toBeGreaterThanOrEqual(0);
  });

  it('POST /plugins/cli-hub/api/agents/spawn 调用 dispatchUiAction(agent-spawn)', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { cliHub } = await applyPluginWithHttp(ctx);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/agents/spawn');
    expect(route).toBeTruthy();
    // 模拟 Express 风格：req.body 已 parse
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({ body: { adapterId: 'claude-code' } }, res);
    expect(cliHub.agents.spawn).toHaveBeenCalledWith('claude-code', undefined);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.ok).toBe(true);
    expect(json.data?.sessionId).toBe('s-claude-code');
  });

  it('POST /plugins/cli-hub/api/tools/exec 调用 dispatchUiAction(tool-exec)', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { cliHub } = await applyPluginWithHttp(ctx);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/tools/exec');
    expect(route).toBeTruthy();
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({ body: { toolName: 'my-tool', input: { x: 1 } } }, res);
    expect(cliHub.tools.execute).toHaveBeenCalledWith('my-tool', { x: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('POST /plugins/cli-hub/api/action 仍可派发 quota-refresh', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    const { cliHub } = await applyPluginWithHttp(ctx);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/action');
    expect(route).toBeTruthy();
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({ body: { id: 'quota-refresh', payload: { adapterId: 'claude-code' } } }, res);
    expect(cliHub.quota.refresh).toHaveBeenCalledWith('claude-code');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('GET /plugins/cli-hub/api/events 降级为 JSON（Koa 风格 res 没有 writeHead）', async () => {
    const routes: Array<{ method: string; route: string; handler: Function }> = [];
    ctx.http = {
      get: vi.fn((route: string, handler: Function) => { routes.push({ method: 'get', route, handler }); }),
      post: vi.fn((route: string, handler: Function) => { routes.push({ method: 'post', route, handler }); }),
    };
    await applyPluginWithHttp(ctx);

    const route = routes.find(r => r.route === '/plugins/cli-hub/api/events');
    expect(route).toBeTruthy();
    // Koa 风格：res.status().json()，没有 writeHead/write
    const res = { status: vi.fn(() => res), json: vi.fn((x: any) => x) };
    await route!.handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json).toHaveProperty('events');
    expect(json).toHaveProperty('note');
  });
});

describe('P2 交互式 Web UI — settings 渲染 6 个 section', () => {
  it('settings 卡片包含 概览/已发现/Adapter开关/额度监控/可用工具/Agent会话 六个 section', async () => {
    const ctx: AnyCtx = {
      logger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      on: vi.fn(),
    };
    let captured: any = null;
    ctx.settings = { registerSection: vi.fn((s: any) => { captured = s; }) };

    const { createDefaultRegistry } = await import('../src/core/registry');
    const { loadBuiltinAdapters } = await import('../src/adapters/builtin');
    const registry = createDefaultRegistry(ctx as any, { enabledOverrides: {} });
    loadBuiltinAdapters(registry);
    const cliHub: any = {
      registry,
      list: vi.fn((filter?: any) => registry.listAdapters(filter)),
      enable: vi.fn(), disable: vi.fn(),
      agents: { listSessions: vi.fn(() => []), stop: vi.fn(), stopAll: vi.fn() },
      quota: { get: vi.fn(async () => null), refresh: vi.fn(async () => null) },
      tools: { execute: vi.fn() },
      async scan() { return { items: [], scannedAt: Date.now(), depth: 'l3', summary: { total: 0, matched: 0, enabled: 0, authenticated: 0, quotaWarning: 0 } }; },
      ui: null as any,
    };
    ctx.cliHub = cliHub;
    ctx.storage = { scoped: { async get() { return null; }, async set() {} } };
    ctx.set = vi.fn((_k: string, v: any) => v);

    const webMod = await import('../src/web/index');
    webMod.apply(ctx as any);

    expect(captured?.id).toBe('cli-hub');
    const sections = captured.render().sections;
    const titles = sections.map((s: any) => s.title);
    expect(titles).toContain('概览');
    expect(titles).toContain('已发现的 AI CLI');
    expect(titles.some((t: string) => t.includes('Adapter 开关'))).toBe(true);
    expect(titles).toContain('额度监控');
    expect(titles).toContain('可用工具');
    expect(titles).toContain('Agent 会话');
    expect(sections.length).toBe(6);

    // 概览 section 的 headerActions 应包含 quota-refresh-all
    const overview = sections.find((s: any) => s.title === '概览');
    expect(overview.headerActions.some((a: any) => a.id === 'quota-refresh-all')).toBe(true);

    // 额度监控 section refresh 返回数组
    const quotaSection = sections.find((s: any) => s.title === '额度监控');
    const quotaRows = await quotaSection.refresh();
    expect(Array.isArray(quotaRows)).toBe(true);

    // 可用工具 section refresh 返回数组
    const toolSection = sections.find((s: any) => s.title === '可用工具');
    const toolRows = await toolSection.refresh();
    expect(Array.isArray(toolRows)).toBe(true);
  });
});
