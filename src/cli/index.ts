/**
 * DSH CLI sub-command extension entry: dsh cli-hub ...
 *
 * DSH CLI plugin (see the packages/cli extension mechanism). If DSH provides
 * ctx.cli.registerSubcommand(), it is registered here; otherwise a manually
 * invokable CLI command set is exported (injected via node --import or dsh patch).
 */
import type { Context } from 'cordis';
import type { ScanDepth } from '../core/types';

export const name = 'dsh-plugin-cli-hub/cli';
// Same design decision as the main plugin: all ctx properties go through safeGet, inject is empty (can always activate)
export const inject = [];

/** Safely read a Cordis ctx property: reflect.get bypass to avoid inject allowlist checks.
 *  Note: even with optional=false passed to reflect.get, some Cordis rc versions still throw
 *  "cannot get property X without inject" — it must be wrapped in two layers of try/catch.
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

  // Read order (from most to least reliable):
  //  1) The "third argument" passed by the main plugin's mountSubPluginDirect (goes through no config/object copying, most reliable)
  //  2) _cliHub written onto the apply function by the main plugin via tagApply
  //  3) cfg._cliHub passed via the main plugin's mountSubPlugin config (plus the double-wrapped cfg.config._cliHub form)
  //  4) ctx.reflect fallback
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

  // ============== Method A: native DSH ctx.cli sub-command registration (if available) ==============
  const cliApi: any = $cli;
  if (cliApi && typeof cliApi.command === 'function') {
    registerDshCli(cliApi, handler, logger);
    return;
  }

  // ============== Method B: standalone command mode: at DSH startup, mount cliHub.cli onto ctx for other scripts to call ==============
  if (typeof $set === 'function') {
    try { $set('cliHubCli', handler as any); } catch {}
  }

  logger?.debug?.('dsh cli API not available; fallback mode exposed as ctx.cliHubCli');
}

function buildCliHandlers(_ctx: Context, hubArg: any = undefined) {
  // hub: the finally usable cliHub (the caller apply guarantees a value; an assert guard is kept here anyway)
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
  // Utility: safely get ctx.tools (lazy retrieval avoids triggering the proxy trap early)
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
    // Use internal execute: if the tool is already registered in ctx.tools, call it directly; otherwise throw
    const toolsApi: any = getToolsApi();
    if (toolsApi && typeof toolsApi.execute === 'function') {
      const r = await toolsApi.execute(toolName, input);
      return json ? JSON.stringify(r, null, 2) : JSON.stringify(r);
    }
    // fallback: try to find the definition in the registry and exec directly
    throw new Error(`ctx.tools.execute not available; cannot run ${toolName}`);
  }

  // ===== Agent debug commands =====
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
    // If the payload parses as JSON, treat it as a JSON message (jsonrpc scenario); otherwise as a plain text line
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

  // ---- Agent sub-commands ----
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

// Same reason as the main plugin: inject must be attached to the apply function object, compatible with the loader reading factory.inject after unwrap
// Note: do not attach apply.Config (otherwise Cordis resolveConfig will attempt Standard Schema.validate and crash)
(apply as any).inject = inject;
Object.defineProperty(apply, 'displayName', { value: name, writable: false, configurable: true });

export default apply;
