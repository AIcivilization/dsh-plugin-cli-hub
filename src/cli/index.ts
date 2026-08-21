/**
 * DSH CLI 子命令扩展入口：dsh cli-hub ...
 *
 * DSH 的 CLI 插件（参考 packages/cli 扩展机制）。如果 DSH 提供了
 * ctx.cli.registerSubcommand()，这里会注册；否则导出一个可以手动调用的
 * CLI 命令集合（通过 node --import 或 dsh patch 注入）。
 */
import type { Context } from 'cordis';
import type { ScanDepth } from '../core/types';

export const name = 'dsh-plugin-cli-hub/cli';
// 与主插件相同的设计决策：所有 ctx 属性都走 safeGet，inject 为空（永远能激活）
export const inject = [];

/** 安全读取 Cordis ctx 属性：reflect.get 旁路，规避 inject 白名单检查。
 *  注：即使 reflect.get 传了 optional=false，在某些 Cordis rc 版本上仍会抛
 *  「cannot get property X without inject」——必须包两层 try/catch。
 */
function safeGet(ctx: any, name: string): any {
  if (!ctx) return undefined;
  try {
    const raw = (ctx as any).internal ?? (ctx as any).raw ?? (ctx as any).root ?? undefined;
    if (raw && Object.prototype.hasOwnProperty.call(raw, name)) return (raw as any)[name];
    const svc = (ctx as any).service;
    if (svc && Object.prototype.hasOwnProperty.call(svc, name)) return svc[name];
  } catch {}
  try {
    if (typeof (ctx as any).get === 'function') {
      const v = (ctx as any).get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}
  try {
    if (ctx.reflect && typeof ctx.reflect.get === 'function') {
      const v = ctx.reflect.get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}
  try {
    const rts = (ctx as any).runtime ?? (ctx.fiber as any)?.runtime;
    if (rts && typeof rts === 'object') {
      const svcMap = (rts as any).services ?? (rts as any)._services;
      if (svcMap && typeof svcMap === 'object' && Object.prototype.hasOwnProperty.call(svcMap, name)) {
        const entry = (svcMap as any)[name];
        if (entry && typeof entry.value !== 'undefined') return entry.value;
        if (entry !== undefined) return entry;
      }
    }
  } catch {}
  try { const v = ctx[name]; if (v !== undefined) return v; } catch {}
  return undefined;
}

export function apply(ctx: Context, cfg: any = undefined, _cliHub3rd: any = undefined) {
  const $logger = safeGet(ctx, 'logger');
  const $cli    = safeGet(ctx, 'cli');
  const $set    = safeGet(ctx, 'set');

  const logger = typeof $logger === 'function' ? $logger('dsh-plugin-cli-hub:cli') : undefined;

  // 读取顺序（按可靠性从强到弱）：
  //  1) 主插件 mountSubPluginDirect 传的「第三实参」（不经过任何 config/对象拷贝，最稳）
  //  2) 主插件通过 tagApply 写在 apply 函数上的 _cliHub
  //  3) 主插件 mountSubPlugin config 传的 cfg._cliHub（以及 cfg.config._cliHub 双重包裹形式）
  //  4) ctx.reflect 兜底
  const from3rd   = _cliHub3rd;
  const fromApply = (apply as any)?._cliHub;
  const fromCfgA  = (cfg as any)?._cliHub;
  const fromCfgB  = (cfg as any)?.config?._cliHub;
  const fromCtx   = safeGet(ctx, 'cliHub');
  const cliHub = from3rd ?? fromApply ?? fromCfgA ?? fromCfgB ?? fromCtx;

  if (!cliHub) {
    logger?.debug?.('cliHub not available, cli sub-command skipped.');
    try { console.debug('[cli-hub:cli] cliHub unavailable — cli sub-command skipped.'); } catch {}
    return;
  }

  const handler = buildCliHandlers(ctx, cliHub);

  // ============== 方式 A：DSH ctx.cli 原生子命令注册（若存在）==============
  const cliApi: any = $cli;
  if (cliApi && typeof cliApi.command === 'function') {
    registerDshCli(cliApi, handler, logger);
    return;
  }

  // ============== 方式 B：独立命令模式：DSH 启动时把 cliHub.cli 挂到 ctx 供其他脚本调 ==============
  if (typeof $set === 'function') {
    try { $set('cliHubCli', handler as any); } catch {}
  }

  logger?.debug?.('dsh cli API not available; fallback mode exposed as ctx.cliHubCli');
}

function buildCliHandlers(_ctx: Context, hubArg: any = undefined) {
  // hub：最终可用的 cliHub（调用方 apply 保证有值；这里仍保留 assert 防御）
  const hub = hubArg as any;
  if (!hub) {
    return {
      scan: async () => 'cliHub not available',
      list: () => 'cliHub not available',
      enable: () => 'cliHub not available',
      disable: () => 'cliHub not available',
      quota: async () => 'cliHub not available',
      toolExec: async () => 'cliHub not available',
      agentSpawn: async () => 'cliHub not available',
      agentList: () => 'cliHub not available',
      agentStatus: () => 'cliHub not available',
      agentSend: async () => 'cliHub not available',
      agentStop: () => 'cliHub not available',
    } as any;
  }
  // 工具函数：安全拿 ctx.tools（延迟获取避免 proxy trap 提前触发）
  const getToolsApi = () => {
    try { return (_ctx as any).reflect?.get?.('tools', false); } catch {}
    try { return (_ctx as any).tools; } catch { return undefined; }
  };

  async function scan(depth: ScanDepth = 'l3', { json = false }: { json?: boolean } = {}) {
    const r = await hub.scan(depth);
    if (json) return JSON.stringify(r, null, 2);
    return renderScanTable(r);
  }

  function list({ onlyEnabled = false, json = false }: { onlyEnabled?: boolean; json?: boolean } = {}) {
    const defs = hub.list({ onlyEnabled });
    type Def = { id: string; name: string; vendor?: string; description: string; capabilities: Record<string, any> };
    if (json) return JSON.stringify(defs.map((d: Def) => ({ id: d.id, name: d.name, vendor: d.vendor, capabilities: Object.keys(d.capabilities) })), null, 2);
    return defs.map((d: Def) => `  · [${d.id}] ${d.name}${d.vendor ? ` (${d.vendor})` : ''} — ${d.description.slice(0, 80)}`).join('\n') || '(no adapters)';
  }

  function enable(adapterId: string) { hub.enable(adapterId); return `enabled: ${adapterId}`; }
  function disable(adapterId: string) { hub.disable(adapterId); return `disabled: ${adapterId}`; }

  async function quota(adapterId?: string, { refresh = false, json = false }: { refresh?: boolean; json?: boolean } = {}) {
    const ids = adapterId ? [adapterId] : hub.list({ onlyEnabled: true }).map((d: any) => d.id);
    const results: any[] = [];
    for (const id of ids) {
      try { results.push({ id, quota: await hub.quota.get(id, refresh) }); }
      catch (e: any) { results.push({ id, error: e?.message ?? String(e) }); }
    }
    if (json) return JSON.stringify(results, null, 2);
    return results.map(r => {
      if (r.error) return `  · [${r.id}] ❌ ${r.error.slice(0, 60)}`;
      const q = r.quota;
      const remain = q.total ? `${q.remaining ?? (q.total - q.used)}/${q.total}` : String(q.used);
      return `  · [${r.id}] ${q.currency} ${remain} (${q.source}${q.period ? '/' + q.period : ''})`;
    }).join('\n');
  }

  async function toolExec(toolName: string, inputJson: string, { json = false }: { json?: boolean } = {}) {
    const input = inputJson ? JSON.parse(inputJson) : {};
    const toolGateway = hub.tools;
    // 用 internal execute：如果 tool 已注册进 ctx.tools，直接调；否则抛错
    const toolsApi: any = getToolsApi();
    if (toolsApi && typeof toolsApi.execute === 'function') {
      const r = await toolsApi.execute(toolName, input);
      return json ? JSON.stringify(r, null, 2) : JSON.stringify(r);
    }
    // fallback：尝试从 registry 找到定义并直接 exec
    throw new Error(`ctx.tools.execute not available; cannot run ${toolName}`);
  }

  // ===== Agent 调试命令 =====
  async function agentSpawn(adapterId: string, { json = false }: { json?: boolean } = {}) {
    const ses = await hub.agents.spawn(adapterId);
    const info = {
      sessionId: ses.sessionId,
      adapterId: ses.adapterId,
      adapterName: ses.adapterName,
      protocol: ses.protocol,
      status: ses.status,
      pid: ses.pid,
      spawnedAt: ses.spawnedAt,
      readyAt: ses.readyAt,
    };
    if (json) return JSON.stringify(info, null, 2);
    return [
      `spawned ${ses.adapterName} (${adapterId})`,
      `  sessionId = ${ses.sessionId}`,
      `  pid       = ${ses.pid ?? '-'}`,
      `  protocol  = ${ses.protocol}`,
      `  status    = ${ses.status}`,
    ].join('\n');
  }

  function agentList({ json = false }: { json?: boolean } = {}) {
    const list = hub.agents.listSessions();
    if (json) return JSON.stringify(list, null, 2);
    if (!list.length) return '(no running agent sessions)';
    return list.map((s: any) => {
      const dur = `${(s.durationMs / 1000).toFixed(1)}s`;
      return `  · [${s.adapterId}] ${s.status}  pid=${s.pid ?? '-'}  dur=${dur}  sid=${s.sessionId}`;
    }).join('\n');
  }

  function agentStatus(adapterId: string, { json = false, tail = 5 }: { json?: boolean; tail?: number } = {}) {
    const ses = hub.agents.getSession(adapterId);
    if (!ses) {
      const m = `no running session for adapter: ${adapterId}`;
      return json ? JSON.stringify({ error: m }) : m;
    }
    const info: any = {
      sessionId: ses.sessionId,
      adapterId: ses.adapterId,
      status: ses.status,
      pid: ses.pid,
      protocol: ses.protocol,
      spawnedAt: ses.spawnedAt,
      readyAt: ses.readyAt,
      endedAt: ses.endedAt,
      durationMs: Date.now() - ses.spawnedAt,
      lastStderr: ses.tailStderr(tail),
    };
    if (json) return JSON.stringify(info, null, 2);
    return [
      `${ses.adapterName} (${adapterId})`,
      `  status   = ${ses.status}`,
      `  pid      = ${ses.pid ?? '-'}`,
      `  protocol = ${ses.protocol}`,
      `  duration = ${(info.durationMs / 1000).toFixed(1)}s`,
      `  last stderr:`,
      `    ${info.lastStderr.split('\n').join('\n    ')}`,
    ].join('\n');
  }

  async function agentStop(adapterId: string, { json = false }: { json?: boolean } = {}) {
    const stopped = await hub.agents.stop(adapterId);
    if (json) return JSON.stringify({ stopped });
    return stopped ? `stopped: ${adapterId}` : `no session: ${adapterId}`;
  }

  async function agentSend(adapterId: string, payload: string, { json = false, timeout = 10 }: { json?: boolean; timeout?: number } = {}) {
    const ses = hub.agents.getSession(adapterId);
    if (!ses) throw new Error(`no running session: ${adapterId}`);
    // 如果 payload 能 parse 成 JSON 就当 JSON 消息（jsonrpc 场景）；否则当纯文本行
    let msg: any = payload;
    try { msg = JSON.parse(payload); } catch {}
    await ses.send(msg);
    try {
      const reply = await ses.recv(timeout * 1000);
      return json ? JSON.stringify(reply, null, 2) : (typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
    } catch (e: any) {
      return json ? JSON.stringify({ error: e?.message ?? String(e) }) : `(no reply in ${timeout}s: ${e?.message ?? e})`;
    }
  }

  return { scan, list, enable, disable, quota, toolExec, agentSpawn, agentList, agentStatus, agentStop, agentSend };
}

function registerDshCli(cliApi: any, h: ReturnType<typeof buildCliHandlers>, logger?: any) {
  cliApi.command('cli-hub scan [depth]', 'Scan local AI CLIs (depth: l1/l2/l3)')
    .option('-j, --json', 'output as JSON')
    .action(async (depthArg?: string, opts: any = {}) => {
      const depth = (depthArg ?? 'l3') as ScanDepth;
      const out = await h.scan(depth, { json: !!opts.json });
      process.stdout.write(typeof out === 'string' ? out + '\n' : JSON.stringify(out, null, 2) + '\n');
    });

  cliApi.command('cli-hub list', 'List known adapters')
    .option('--only-enabled', 'only show enabled adapters')
    .option('-j, --json')
    .action(async (opts: any) => {
      const out = await h.list({ onlyEnabled: !!opts.onlyEnabled, json: !!opts.json });
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub enable <adapterId>', 'Enable an adapter')
    .action((id: string) => { process.stdout.write(h.enable(id) + '\n'); });
  cliApi.command('cli-hub disable <adapterId>', 'Disable an adapter')
    .action((id: string) => { process.stdout.write(h.disable(id) + '\n'); });

  cliApi.command('cli-hub quota [adapterId]', 'Show quota usage')
    .option('-r, --refresh', 'force refresh')
    .option('-j, --json')
    .action(async (id: string | undefined, opts: any) => {
      const out = await h.quota(id, { refresh: !!opts.refresh, json: !!opts.json });
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub tool exec <toolName> [inputJson]', 'Execute a cli-hub tool')
    .option('-j, --json')
    .action(async (name: string, input?: string, opts?: any) => {
      const out = await h.toolExec(name, input ?? '{}', { json: !!(opts?.json ?? true) });
      process.stdout.write(out + '\n');
    });

  // ---- Agent 子命令 ----
  cliApi.command('cli-hub agent spawn <adapterId>', 'Start an agent session (claude-code / snow-cli)')
    .option('-j, --json')
    .action(async (id: string, opts: any) => {
      const out = await h.agentSpawn(id, { json: !!opts.json });
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub agent list', 'List active agent sessions')
    .option('-j, --json')
    .action(async (opts: any) => {
      const out = h.agentList({ json: !!opts.json }) as string;
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub agent status <adapterId>', 'Show status of a running agent')
    .option('-j, --json')
    .option('--tail <n>', 'stderr tail lines', 5)
    .action(async (id: string, opts: any) => {
      const out = h.agentStatus(id, { json: !!opts.json, tail: Number(opts.tail ?? 5) }) as string;
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub agent stop <adapterId>', 'Stop an agent session')
    .option('-j, --json')
    .action(async (id: string, opts: any) => {
      const out = await h.agentStop(id, { json: !!opts.json });
      process.stdout.write(out + '\n');
    });

  cliApi.command('cli-hub agent send <adapterId> <payload>', 'Send one message and wait one reply (debug jsonrpc/line protocol)')
    .option('-j, --json')
    .option('--timeout <seconds>', 'reply timeout (s)', 10)
    .action(async (id: string, payload: string, opts: any) => {
      const out = await h.agentSend(id, payload, { json: !!opts.json, timeout: Number(opts.timeout ?? 10) });
      process.stdout.write(out + '\n');
    });

  logger?.debug?.('registered dsh cli-hub subcommands');
}

function renderScanTable(r: any): string {
  const lines: string[] = [];
  lines.push(`Scan depth=${r.depth}, total=${r.summary.total}, matched=${r.summary.matched}, enabled=${r.summary.enabled}, authenticated=${r.summary.authenticated}`);
  lines.push('');
  const header = `  STATUS  ADAPTER         VERSION        AUTH        PATH`;
  lines.push(header);
  lines.push('  ' + '—'.repeat(Math.max(0, header.length - 2)));
  for (const it of r.items) {
    const adapter = (it.adapterId ?? '?').padEnd(14, ' ').slice(0, 14);
    const version = (it.version ?? '-').padEnd(14, ' ').slice(0, 14);
    const auth = it.authState.padEnd(11, ' ').slice(0, 11);
    const status = it.adapterId ? '✓' : '·';
    lines.push(`  ${status}      ${adapter} ${version} ${auth} ${it.executablePath}`);
    if (it.authHint) lines.push(`           ↪ ${it.authHint}`);
    if (it.error)    lines.push(`           ✗ ${it.error.slice(0, 120)}`);
  }
  return lines.join('\n');
}

// 与主插件同样原因：inject 需挂在 apply 函数对象上，兼容 loader unwrap 后读 factory.inject
// 注意：不要挂 apply.Config（否则 Cordis resolveConfig 会尝试 Standard Schema.validate 崩）
(apply as any).inject = inject;
Object.defineProperty(apply, 'displayName', { value: name, writable: false, configurable: true });

export default apply;
