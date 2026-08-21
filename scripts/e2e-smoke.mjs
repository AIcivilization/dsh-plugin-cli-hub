#!/usr/bin/env node
/* =========================================================================
 * scripts/e2e-smoke.mjs —— 不需要写入 ~/.dsh 的最小端到端冒烟测试
 *
 * 覆盖目标：
 *   [ ] P1-8 验证: apply() 成功后 ctx.cliHub 挂载 + ToolGateway.syncRegistrations 真正调用 ctx.tools.define
 *   [ ] Scanner 真 L3 扫描: 实际扫本机 PATH 并命中 ~/.local/bin/claude (Claude Code 2.1.235 / pro)
 *   [ ] AgentGateway 端到端: 用 /tmp 下的假脚本模拟 jsonrpc + line-based，验证 spawn/ready/send/recv/shutdown
 *
 * 运行:  node scripts/e2e-smoke.mjs
 * =======================================================================*/
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn as cp_spawn } from 'node:child_process';

const ok = (k, s) => console.log(`\x1b[32m ✓ PASS\x1b[0m  ${k}${s ? ' — ' + s : ''}`);
const fail = (k, e) => { console.error(`\x1b[31m ✗ FAIL\x1b[0m  ${k}\n   ${String(e?.stack || e).split('\n').slice(0,4).join('\n   ')}`); process.exitCode = 1; };

// =============== 1. 加载插件 ===============
const DIST = path.resolve(process.cwd(), 'dist/index.js');
const PKG = await import(DIST);
const { apply, name, defineCliAdapter, webSubPlugin } = PKG;
console.log(`\n\x1b[1m[e2e] 加载插件: ${name} from ${DIST}\x1b[0m`);

// =============== 2. 构造最小 Cordis Context ===============
const mem = {};
const toolsCalls = [];   // 记录 ctx.tools.define / defineTool / dispose 调用
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
  // ---- 真实子进程执行（GatewayTool 必须用 ctx.subprocess，Scanner/Quota 会 fallback 到 node child_process 但我们也给一个真 exec）----
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
  // ---- ctx.tools: DSH 真正的工具注册入口。这里记录所有 define 调用，返回带 dispose 的句柄（我们不真实注册）----
  tools: {
    define(def) {
      toolsCalls.push({ action: 'define', name: def.name, description: def.description?.slice(0, 40) });
      return {
        dispose() { toolsCalls.push({ action: 'dispose', name: def.name }); },
      };
    },
  },
  // ---- events: 实现 Cordis 最小事件 on/emit/off（我们没有用 EventEmitter2，自己写一个）----
  _eventHandlers: new Map(),
  on(event, handler) {
    let arr = this._eventHandlers.get(event);
    if (!arr) { arr = new Set(); this._eventHandlers.set(event, arr); }
    arr.add(handler);
    return () => this.off(event, handler);
  },
  off(event, handler) { this._eventHandlers.get(event)?.delete(handler); },
  emit(event, payload) { for (const h of this._eventHandlers.get(event) ?? []) { try { h(payload); } catch {} } },
  // ---- ctx.set (duck-typing 为 Cordis ctx.set) ----
  _props: {},
  set(key, value) { this._props[key] = value; },
  get(key) { return this._props[key]; },
  // ---- ctx.plugin（子插件挂载，插件入口会用到）----
  plugin: () => {
    // 简化：当 plugins 里的 cliPlugin/webPlugin 被手动 apply 时，不需要真实 Cordis，
    // 我们在 apply 里的 fallback 路径（检测 ctx.plugin 是否可调用）会自动 duck-typing 绕过。
  },
};

// =============== 3. apply 插件 ===============
console.log('\x1b[1m--- Phase 1: 插件装配 apply(ctx) ---\x1b[0m');
try {
  await apply(ctx);
  const svc = ctx.cliHub ?? ctx.get?.('cliHub');
  if (!svc) throw new Error('apply(ctx) 之后 ctx.cliHub 未挂载');
  ok('apply: ctx.cliHub 挂载', `service shape = scan/registry/quota/tools/agents = ${!!svc.scan}/${!!svc.registry}/${!!svc.quota}/${!!svc.tools}/${!!svc.agents}`);
} catch (e) {
  fail('apply: 插件装配', e);
  console.log('\n[e2e] 装配失败，终止后续步骤');
  process.exit(1);
}
const cliHub = ctx.cliHub;

// =============== 4. 注册一个最小假 adapter 给 ToolGateway 测试 + 开始 ctx.tools.define 记录验证 ===============
console.log('\n\x1b[1m--- Phase 2: P1-8 ToolGateway 注册 ctx.tools.define 验证 ---\x1b[0m');
try {
  const echoAdapter = defineCliAdapter({
    id: 'echo-smoke',
    name: 'Echo Smoke',
    description: 'e2e 用的 echo 工具，用于验证 tools.define 被真调用',
    fingerprint: { commandNames: ['echo'] },
    capabilities: {
      tools: [{
        dshToolName: 'cli-hub:echo-smoke:say',
        description: '回显输入，e2e 测试',
        inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        commandMapping: { kind: 'template', template: 'echo {{message}}' },
        outputParser: 'stdout-text',
      }, {
        dshToolName: 'cli-hub:echo-smoke:reverse',
        description: '反向回显',
        inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        commandMapping: { kind: 'template', template: "bash -c 'echo {{message}} | rev'" },
        outputParser: 'stdout-text',
      }],
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
  cliHub.registry.register(echoAdapter);

  // 构造一个 ScanItem 触发 ToolGateway.syncRegistrations
  const item = {
    adapterId: 'echo-smoke',
    executablePath: '/bin/echo',
    commandName: 'echo',
    authState: 'authenticated',
    scannedDepth: 'l1',
  };
  await cliHub.tools.syncRegistrations([item]);
  const defineCount = toolsCalls.filter(c => c.action === 'define').length;
  if (defineCount === 0) throw new Error('ctx.tools.define 一次都没被调');
  ok(`tools.syncRegistrations: ctx.tools.define 被调用 ${defineCount} 次`,
      toolsCalls.map(c=>`${c.action}:${c.name}`).join(', '));
} catch (e) { fail('P1-8 ToolGateway 注册', e); }

// =============== 5. Scanner L3 扫本机真实 claude ===============
console.log('\n\x1b[1m--- Phase 3: 真实 Scanner L3 扫本机 PATH (探测 claude) ---\x1b[0m');
try {
  // 确保 ~/.local/bin 在 PATH（scan 里面读的 process.env.PATH，所以这里要 export）
  const localBin = `${process.env.HOME}/.local/bin`;
  if (!process.env.PATH.split(':').includes(localBin)) process.env.PATH = localBin + ':' + process.env.PATH;

  const result = await cliHub.scan({ depth: 'l3', timeoutPerCmd: 10000 });
  const items = Array.isArray(result) ? result : (result?.items ?? []);
  const hit = items.find(i => i.adapterId === 'claude-code');
  if (!hit) {
    console.warn('   [warn] 未发现 claude-code（当前 PATH: ' + process.env.PATH.split(':').slice(0,5).join(':') + ':...' + '）');
    fail('Scanner L3: 发现 claude-code', new Error('没命中，可能 PATH 没包含 ~/.local/bin'));
  } else {
    const extras = [];
    if (hit.version) extras.push(`version=${hit.version}`);
    if (hit.authState) extras.push(`auth=${hit.authState}`);
    if (hit.metadata) extras.push(`metadataKeys=${Object.keys(hit.metadata).join(',')}`);
    ok(`Scanner L3: 发现 claude-code @ ${hit.commandName}`, extras.join(' | '));
    if (hit.version) {
      const is2 = /^[23]\./.test(hit.version);
      is2 ? ok('Scanner 版本解析非空且 >= 2.x', hit.version) : fail('Scanner 版本解析', new Error('版本 ' + hit.version + ' 异常'));
    }
    if (hit.authState === 'authenticated') {
      ok('Scanner authState = authenticated (已登录)');
    } else {
      console.warn(`   [warn] authState = ${hit.authState}，authCheck 可能需要调整 regex`);
    }
  }
} catch (e) { fail('Scanner L3 扫 claude', e); }

// =============== 6. AgentGateway 端到端（临时假脚本） ===============
console.log('\n\x1b[1m--- Phase 4: AgentGateway 端到端（假脚本模拟 jsonrpc + line-based） ---\x1b[0m');
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-e2e-'));
console.log(`   tmpdir = ${tmpdir}`);
try {
  // ---- 6a. 注册两个假 adapter ----
  const jsonrpcShim = path.join(tmpdir, 'fake-jsonrpc-agent.sh');
  fs.writeFileSync(jsonrpcShim, [
    '#!/bin/sh',
    '# 模拟 stdio-jsonrpc 协议',
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

  // ---- 注册两个 Agent-only adapter ----
  const jsonrpcAd = defineCliAdapter({
    id: 'e2e-jsonrpc',
    name: 'E2E JsonRpc',
    description: '假脚本',
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
    description: '假脚本',
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
    ok(`AgentGateway.spawn jsonrpc pid=${s.pid}`, `status=waiting-ready→${s.status}`);
    const resp = await s.request('tools/list', {}, 6000);
    // AgentGateway.request 已拆包，直接是解析后的 result body
    if (resp?.capabilities?.echo !== true) throw new Error('jsonrpc result 不对: ' + JSON.stringify(resp));
    ok('AgentGateway jsonrpc: request → 路由到对应 id 并解析 result', JSON.stringify(resp));
    await s.shutdown();
    ok(`AgentGateway jsonrpc: graceful shutdown`, `exit=${s.exitCode ?? null} endedAt set=${!!s.endedAt}`);
  }

  // ---- 6c. Line-based spawn + send + recv ----
  {
    const s = await cliHub.agents.spawn('e2e-line', { timeoutMs: 10_000 });
    ok(`AgentGateway.spawn line-based pid=${s.pid}`);
    await s.send('hi line agent');
    // recv 返回 { line: string }（doc 见 gateway-agent.ts AgentSession.recv）
    const wrap = await s.recv(6000);
    const line = typeof wrap === 'object' ? (wrap?.line ?? '') : String(wrap);
    if (!String(line).includes('echo: hi line agent')) throw new Error('line 回显不对: ' + JSON.stringify(wrap));
    ok('AgentGateway line-based: send → recv', String(line).trim());
    await s.shutdown();
    ok(`AgentGateway line-based: shutdown`, `endedAt set=${!!s.endedAt}`);
  }

  // ---- 6d. stopAll: 同时 spawn 两个，确认 stopAll 清理 ----
  const sA = await cliHub.agents.spawn('e2e-line', { timeoutMs: 8000 });
  const sB = await cliHub.agents.spawn('e2e-jsonrpc', { timeoutMs: 8000 });
  const n = cliHub.agents.listSessions().length;
  ok('AgentGateway 并行 session 数 = ' + n, '预期 = 2');
  if (n !== 2) fail('AgentGateway 并行 session 数', new Error('listSessions().length 不是 2，而是 ' + n));
  await cliHub.agents.stopAll();
  const remain = cliHub.agents.listSessions().length;
  remain === 0 ? ok('AgentGateway.stopAll 清理', '剩余 session = 0') : fail('AgentGateway.stopAll 清理', new Error('剩余 ' + remain));
} catch (e) { fail('AgentGateway 端到端', e); }
finally {
  // 确保所有进程都杀掉
  try { await cliHub.agents.stopAll(); } catch {}
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
}

// =============== 6b. Web UI 挂载（Phase 5：验证 settings 注册/内存 ui API/真实开关） ===============
console.log('\n\x1b[1m--- Phase 5: Web UI 挂载（Scanner 展示 + Adapter 开关） ---\x1b[0m');
{
  // settings/clientPages 假 ctx 注入
  const fakeSettings = {};
  fakeSettings.registerSection = function (s) { fakeSettings.last = s; return s; };
  const ctx2 = ctx;
  ctx2.settings = fakeSettings;
  ctx2.clientPages = { register: (_p) => { ctx2._clientPageRegistered = true; } };
  ctx2.router = {
    get: (route, h) => ((ctx2._routesGet = ctx2._routesGet || []).push({ route, h })),
    post: (route, h) => ((ctx2._routesPost = ctx2._routesPost || []).push({ route, h })),
  };
  // web 子插件：使用第一次 import 时捕获到的 webSubPlugin 直接 apply（避免 cache-bust 导致的重复实例化）
  try {
    if (webSubPlugin && typeof webSubPlugin.apply === 'function') {
      webSubPlugin.apply(ctx);
    } else {
      throw new Error('PKG.webSubPlugin 不存在（src/index.ts 是否 export const webSubPlugin = webPlugin?）');
    }
  } catch (e) {
    fail('Web 子插件挂载', new Error('apply webPlugin failed: ' + (e?.message ?? String(e))));
  }

  // --- P5-1: settings.registerSection 注册成功且 id=cli-hub ---
  if (!fakeSettings.last) fail('settings.registerSection 调用', new Error('未调用 registerSection'));
  else {
    ok('Web UI: settings.registerSection 注册', 'id=' + fakeSettings.last.id);
    if (fakeSettings.last.id !== 'cli-hub') fail('section id 错误', new Error(fakeSettings.last.id));
    const r = fakeSettings.last.render();
    Array.isArray(r && r.sections)
      ? ok('Web UI: settings.render 产出 sections 数组', 'count=' + r.sections.length)
      : fail('settings.render', new Error('sections 不是数组'));
  }

  // --- P5-2: ctx.router.get/post 已注册（HTTP API 兜底路径）---
  const got = ctx2._routesGet || [];
  const post = ctx2._routesPost || [];
  const routes = got.concat(post);
  if (routes.length >= 5) ok('Web UI: HTTP 路由已注册', 'GET=' + got.length + ' POST=' + post.length + '（覆盖 dashboard/adapters/scan/sessions/action）');
  else fail('HTTP 路由注册', new Error('路由太少 ' + routes.length));

  // --- P5-3: 内存 ui API — dashboard/adapterRows 至少含 claude-code，且 version/auth 正确 ---
  const ui = ctx.cliHub.ui;
  if (!ui) fail('cliHub.ui 内存 API', new Error('不存在'));
  else {
    const d = await ui.getDashboard();
    ok('Web UI: ui.getDashboard shape ok', 'adaptersTotal=' + d.adaptersTotal + ' sessionsCount=' + d.sessionsCount);
    if (d.adaptersTotal < 1) fail('dashboard adaptersTotal', new Error('为 0'));
    const adapters = await ui.getAdapterRows();
    const cc = adapters.find((x) => x.id === 'claude-code');
    if (!cc) fail('adapter row claude-code', new Error('未找到'));
    else {
      ok('Web UI: adapter row 有 claude-code', 'defaultEnabled=' + cc.defaultEnabled);
      if (typeof cc.enabled === 'boolean') ok('Web UI: adapter.enabled 可投影', String(cc.enabled));
      else fail('adapter.enabled 字段', new Error('不是 boolean'));
    }
    // Scanner 投影
    const rows = await ui.getScannerRows('l1');
    if (Array.isArray(rows)) ok('Web UI: getScannerRows 返回数组', 'rows=' + rows.length);
    else fail('getScannerRows', new Error('不是数组'));
    // dispatch 真实触发开关
    const res = await ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: false });
    if (res && res.ok === true) ok('Web UI: dispatch(toggle-adapter → disable)', String(res.message || ''));
    else fail('dispatch toggle disable', new Error(JSON.stringify(res)));
    // disable 后 registry 应该是 enabled=false
    const afterDisable = ctx.cliHub.registry && ctx.cliHub.registry.isEnabled && ctx.cliHub.registry.isEnabled('claude-code');
    if (afterDisable === false) ok('Web UI: disable → registry enabled=false', '已持久化');
    else fail('registry 状态同步', new Error('enabled not false: ' + afterDisable));
    // 恢复回来
    await ui.dispatch('toggle-adapter', { adapterId: 'claude-code', enabled: true });
    if (ctx.cliHub.registry && ctx.cliHub.registry.isEnabled && ctx.cliHub.registry.isEnabled('claude-code') === true) ok('Web UI: re-enable ok', '');
    else fail('registry enable 恢复', new Error('状态未回到 true'));
  }

  // --- P5-4: Scanner 投影不包含非法 undefined 字段 ---
  if (ctx.cliHub && ctx.cliHub.ui) {
    const allRows = await ctx.cliHub.ui.getScannerRows('l1');
    const serializable = !JSON.stringify(allRows).includes('undefined');
    if (serializable) ok('Web UI: Scanner Rows serializable（无 undefined 字段残留）', '');
    else fail('序列化失败', new Error('JSON 中含有 undefined 字段'));
  } else {
    fail('Scanner 序列化校验', new Error('ui 不存在，跳过'));
  }

  // --- P5-5 (P2): 新增视图函数 getQuotaRows / getToolRows / getAdapterDetail ---
  if (ctx.cliHub && ctx.cliHub.ui) {
    const ui = ctx.cliHub.ui;
    // getQuotaRows
    const quotaRows = await ui.getQuotaRows();
    if (Array.isArray(quotaRows)) ok('Web UI: getQuotaRows 返回数组', 'rows=' + quotaRows.length);
    else fail('getQuotaRows', new Error('不是数组'));

    // getToolRows
    const toolRows = await ui.getToolRows();
    if (Array.isArray(toolRows)) ok('Web UI: getToolRows 返回数组', 'rows=' + toolRows.length);
    else fail('getToolRows', new Error('不是数组'));

    // getAdapterDetail
    const detail = await ui.getAdapterDetail('claude-code');
    if (detail && detail.id === 'claude-code') {
      ok('Web UI: getAdapterDetail shape ok', 'id=' + detail.id + ' hasTools=' + !!(detail.capabilities && detail.capabilities.tools) + ' hasAgent=' + !!(detail.capabilities && detail.capabilities.agent));
      // 序列化校验
      const s = JSON.stringify(detail);
      if (!s.includes('undefined')) ok('Web UI: adapterDetail serializable', '');
      else fail('adapterDetail 序列化', new Error('含 undefined'));
    } else fail('getAdapterDetail', new Error('返回 null 或 id 不匹配'));
  }

  // --- P5-6 (P2): 新 HTTP 端点 /quota /tools /adapters/:id 已注册 ---
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
  if (missing.length === 0) ok('Web UI: P2 新 HTTP 端点已注册', 'count=' + expectNew.length);
  else fail('P2 新端点缺失', new Error('missing: ' + missing.join(', ')));

  // --- P5-7 (P2): dispatch 新动作（show-install-hint / adapter-detail / quota-refresh）---
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

// =============== 7. 汇总 ===============
process.exitCode = process.exitCode || 0;
console.log('\n\x1b[1m=== e2e 结束 ===\x1b[0m');
console.log(process.exitCode === 0
  ? '\x1b[32m 全部通过 ✅\x1b[0m'
  : '\x1b[31m 有失败项，exit code = ' + process.exitCode + ' ❌\x1b[0m');
