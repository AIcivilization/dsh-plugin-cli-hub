/**
 * dsh-plugin-cli-hub Web UI panel
 *
 * Three compatible paths (at least one must take effect; order 1 → 2 → 3 as fallback):
 *
 *   1) ctx.settings.registerSection — DSH settings page card-style structure
 *   2) ctx.clientPages.register   — DSH standalone route page (/cli-hub), server-driven component tree
 *   3) ctx.http / ctx.router REST JSON endpoints — any external frontend can fetch;
 *      if all else fails, the ctx.cliHub.ui in-memory API is also mounted (for direct calls from CLI / other plugin code).
 *
 * Capabilities:
 *   · Scanner data display (last scan + manual rescan + progress)
 *   · Adapter enable/disable toggles (actually writes back to registry + storage + agent stop + tool unregister)
 *   · Agent sessions table + stop button
 *   · Dashboard summary (total/matched/enabled/authenticated/session count)
 *
 * No frontend build dependencies; all UI descriptions are returned as JSON component trees, rendering is handled by DSH.
 */
import type { Context } from 'cordis';
import type {
  AuthState,
  CliAdapterDefinition,
  ScanItem,
  ScanResult,
  ScanDepth,
} from '../core/types';
import { DASHBOARD_HTML } from './dashboard-html';

export const name = 'dsh-plugin-cli-hub/web';
// Same design decision as the main plugin: all ctx properties go through safeGet, inject is empty (always activatable)
// This way in pure CLI mode (dsh cli hub list), the plugin won't stay pending forever due to a missing webServer service;
// HTTP routes are mounted after apply's deferred polling via safeGet obtains webServer; skipped if unavailable.
export const inject: string[] = [];

/** Safe property access consistent with the main plugin: bypasses the inject allowlist check.
 *  Note: Cordis rc versions throw "cannot get property X without inject" even for reflect.get(prop,false)
 *  — must try/catch the whole chain, prefer reading directly from raw/internal.
 */
function safeGet(ctx: any, propName: string): any {
  if (!ctx) return undefined;
  try {
    const raw = ctx.internal ?? ctx.raw ?? ctx.root ?? undefined;
    if (raw && Object.prototype.hasOwnProperty.call(raw, propName)) return raw[propName];
    const svc = ctx.service;
    if (svc && Object.prototype.hasOwnProperty.call(svc, propName)) return svc[propName];
  } catch {}
  try {
    if (typeof ctx.get === 'function') {
      const v = ctx.get(propName, false);
      if (v !== undefined) return v;
    }
  } catch {}
  try {
    if (ctx.reflect && typeof ctx.reflect.get === 'function') {
      const v = ctx.reflect.get(propName, false);
      if (v !== undefined) return v;
    }
  } catch {}
  try {
    const rts = ctx.runtime ?? ctx.fiber?.runtime;
    if (rts && typeof rts === 'object') {
      const svcMap = rts.services ?? rts._services;
      if (svcMap && typeof svcMap === 'object' && Object.prototype.hasOwnProperty.call(svcMap, propName)) {
        const entry = svcMap[propName];
        if (entry && typeof entry.value !== 'undefined') return entry.value;
        if (entry !== undefined) return entry;
      }
    }
  } catch {}
  try { const v = ctx[propName]; if (v !== undefined) return v; } catch {}
  return undefined;
}

// ============================================================
// UI data projections (pure functions, zero runtime deps / zero side effects)
// ============================================================
export interface UiScannerRow {
  id: string;
  displayName: string;
  commandName: string;
  executablePath: string;
  version: string | null;
  auth: AuthState;
  authBadge: { label: string; color: string };
  authHint?: string;
  capabilities: Array<'tool' | 'agent'>;
  quotaPercent?: number | null;
  quotaCurrency?: string;
  enabled: boolean;
  installed: boolean;
  scannedDepth: string;
  installHint?: string;
  vendor?: string;
  actions: Array<{ id: string; label: string; variant?: string; payload?: any }>;
}

export interface UiAdapterRow {
  id: string;
  name: string;
  vendor?: string;
  description: string;
  capabilities: Array<'tool' | 'agent'>;
  commandNames: string[];
  enabled: boolean;
  installed: boolean;          // exists in registry (always true, kept for future extension)
  discovered: boolean;         // whether the last scan actually discovered this CLI on this machine
  version?: string | null;
  auth?: AuthState;
  authBadge?: { label: string; color: string };
  installHint?: string;
  officialDoc?: string;
  defaultEnabled: boolean;
  actions: Array<{ id: string; label: string; variant?: string; payload?: any }>;
}

export interface UiSessionRow {
  sessionId: string;
  adapterId: string;
  adapterName: string;
  status: string;
  pid?: number;
  durationMs: number;
  protocol?: string;
  actions: Array<{ id: string; label: string; variant?: string; payload?: any }>;
}

export interface UiQuotaRow {
  adapterId: string;
  adapterName: string;
  used: number;
  total?: number;
  remaining?: number;
  currency: string;
  period?: string;
  source: string;
  refreshedAt: number;
  percent?: number | null;
  warning?: boolean;
  error?: string;
}

export interface UiToolRow {
  toolName: string;
  adapterId: string;
  adapterName: string;
  description: string;
  inputSchema: any;
  estimatedCredits: number;
  timeoutMs: number;
  enabled: boolean;
}

export interface UiAdapterDetail {
  id: string;
  name: string;
  vendor?: string;
  description: string;
  icon?: string;
  officialDoc?: string;
  installHint?: string;
  defaultEnabled: boolean;
  fingerprint: {
    commandNames: string[];
    versionArgs?: string[];
    configPaths?: string[];
    envVars?: string[];
  };
  capabilities: {
    tools?: UiToolRow[];
    agent?: {
      protocol: string;
      displayName?: string;
      avatarEmoji?: string;
      strengths?: string[];
      supportsStreaming?: boolean;
    };
  };
  quota?: UiQuotaRow | null;
  scanInfo?: {
    version: string | null;
    auth: AuthState;
    authBadge: { label: string; color: string };
    authHint?: string;
    executablePath: string;
    discoveredAt: number | null;
  } | null;
  enabled: boolean;
}

export interface UiDashboard {
  scannedAt: number | null;
  depth: ScanDepth;
  summary: {
    total: number;
    matched: number;
    enabled: number;
    authenticated: number;
    quotaWarning: number;
  };
  sessionsCount: number;
  adaptersTotal: number;
  adaptersEnabled: number;
}

export type UiActionId =
  | 'scan'
  | 'toggle-adapter'
  | 'enable-all-authed'
  | 'disable-all'
  | 'agent-spawn'
  | 'agent-stop'
  | 'agent-stop-all'
  | 'agent-send'
  | 'quota-refresh'
  | 'quota-refresh-all'
  | 'tool-exec'
  | 'show-install-hint'
  | 'adapter-detail';

export interface UiActionResult {
  ok: boolean;
  message?: string;
  data?: any;
}

const AUTH_COLORS: Record<AuthState, string> = {
  authenticated: 'success',
  unauthenticated: 'warning',
  expired: 'danger',
  unknown: 'muted',
};

const AUTH_LABELS: Record<AuthState, string> = {
  authenticated: 'Logged in',
  unauthenticated: 'Not logged in',
  expired: 'Credentials expired',
  unknown: 'Unknown',
};

function authBadge(s: AuthState) {
  return { label: AUTH_LABELS[s], color: AUTH_COLORS[s] };
}

// Collapse capability flags into a label array
function capsOf(def: CliAdapterDefinition | undefined): Array<'tool' | 'agent'> {
  if (!def) return [];
  const out: Array<'tool' | 'agent'> = [];
  if (def.capabilities.tools?.length) out.push('tool');
  if (def.capabilities.agent) out.push('agent');
  return out;
}

// registry + lastScan → two table structures (Scanner discovered table / Adapter inventory table)
export function projectScannerRows(
  items: ScanItem[],
  opts: {
    registryGet: (id: string) => CliAdapterDefinition | undefined;
    registryEnabled: (id: string) => boolean;
  },
): UiScannerRow[] {
  return items.map((i) => {
    const def = i.adapterId ? opts.registryGet(i.adapterId) : undefined;
    const enabled = !!i.adapterId && opts.registryEnabled(i.adapterId);
    const caps = capsOf(def);
    const actions: UiScannerRow['actions'] = [];
    if (i.adapterId) {
      actions.push({
        id: 'toggle-adapter',
        label: enabled ? 'Disable' : 'Enable',
        variant: enabled ? 'danger' : 'primary',
        payload: { adapterId: i.adapterId, enabled: !enabled },
      });
    }
    if (i.authState === 'unauthenticated' && def?.installHint) {
      actions.push({ id: 'show-install-hint', label: 'Login guide', variant: 'info', payload: { adapterId: def.id } });
    }
    return {
      id: i.adapterId ?? `cmd:${i.commandName}:${i.executablePath}`,
      displayName: def?.name ?? i.commandName,
      commandName: i.commandName,
      executablePath: i.executablePath,
      version: i.version ?? null,
      auth: i.authState,
      authBadge: authBadge(i.authState),
      authHint: i.authHint,
      capabilities: caps,
      enabled: !!i.adapterId && enabled,
      installed: true,
      scannedDepth: i.scannedDepth,
      installHint: def?.installHint,
      vendor: def?.vendor,
      actions,
    };
  });
}

export function projectAdapterRows(
  adapters: CliAdapterDefinition[],
  opts: {
    registryEnabled: (id: string) => boolean;
    scanItems?: ScanItem[] | null;
  },
): UiAdapterRow[] {
  const byId = new Map<string, ScanItem>();
  for (const it of opts.scanItems ?? []) if (it.adapterId) byId.set(it.adapterId, it);
  return adapters.map((def) => {
    const scan = byId.get(def.id);
    const enabled = opts.registryEnabled(def.id);
    const actions: UiAdapterRow['actions'] = [
      {
        id: 'toggle-adapter',
        label: enabled ? 'Disable' : 'Enable',
        variant: enabled ? 'danger' : 'primary',
        payload: { adapterId: def.id, enabled: !enabled },
      },
    ];
    if (def.installHint && !scan) {
      actions.push({ id: 'show-install-hint', label: 'Install guide', variant: 'info', payload: { adapterId: def.id } });
    }
    return {
      id: def.id,
      name: def.name,
      vendor: def.vendor,
      description: def.description,
      capabilities: capsOf(def),
      commandNames: def.fingerprint.commandNames,
      enabled,
      installed: true,
      discovered: !!scan,
      version: scan?.version ?? null,
      auth: scan?.authState,
      authBadge: scan ? authBadge(scan.authState) : undefined,
      installHint: def.installHint,
      officialDoc: def.officialDoc,
      defaultEnabled: def.defaultEnabled !== false,
      actions,
    };
  });
}

export function projectSessionRows(
  sessions: Array<{ sessionId: string; adapterId: string; status: string; pid?: number; durationMs: number; protocol?: string }>,
  registryGet: (id: string) => CliAdapterDefinition | undefined,
): UiSessionRow[] {
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    adapterId: s.adapterId,
    adapterName: registryGet(s.adapterId)?.name ?? s.adapterId,
    status: s.status,
    pid: s.pid,
    durationMs: s.durationMs,
    protocol: s.protocol,
    actions: [
      { id: 'agent-send', label: 'Send message', variant: 'default', payload: { adapterId: s.adapterId, sessionId: s.sessionId } },
      { id: 'agent-stop', label: 'Stop', variant: 'danger', payload: { adapterId: s.adapterId } },
    ],
  }));
}

export function projectQuotaRow(
  adapterId: string,
  adapterName: string,
  q: any,
): UiQuotaRow {
  const used = Number(q?.used ?? 0);
  const total = q?.total != null ? Number(q.total) : undefined;
  const remaining = q?.remaining != null
    ? Number(q.remaining)
    : (total != null ? Math.max(0, total - used) : undefined);
  const percent = (total != null && total > 0) ? Math.round((used / total) * 100) : null;
  const warning = percent != null && percent >= 90;
  return {
    adapterId,
    adapterName,
    used,
    total,
    remaining,
    currency: q?.currency ?? 'credits',
    period: q?.period,
    source: q?.source ?? 'unknown',
    refreshedAt: q?.refreshedAt ?? Date.now(),
    percent,
    warning,
    error: q?.error,
  };
}

export function projectToolRows(
  adapters: CliAdapterDefinition[],
  opts: {
    registryEnabled: (id: string) => boolean;
    scanItems?: ScanItem[] | null;
  },
): UiToolRow[] {
  const byId = new Map<string, ScanItem>();
  for (const it of opts.scanItems ?? []) if (it.adapterId) byId.set(it.adapterId, it);
  const rows: UiToolRow[] = [];
  for (const def of adapters) {
    const scan = byId.get(def.id);
    // Only show tools of discovered and authenticated adapters (avoids listing tools whose CLI isn't installed)
    if (!scan || scan.authState === 'unauthenticated' || scan.authState === 'expired') continue;
    const enabled = opts.registryEnabled(def.id);
    for (const t of def.capabilities.tools ?? []) {
      rows.push({
        toolName: t.dshToolName,
        adapterId: def.id,
        adapterName: def.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        estimatedCredits: t.estimatedCredits ?? 0,
        timeoutMs: t.timeoutMs ?? 0,
        enabled,
      });
    }
  }
  return rows;
}

export function projectAdapterDetail(
  def: CliAdapterDefinition,
  opts: {
    registryEnabled: (id: string) => boolean;
    scan?: ScanItem | null;
    quota?: any | null;
  },
): UiAdapterDetail {
  const enabled = opts.registryEnabled(def.id);
  const tools: UiToolRow[] | undefined = def.capabilities.tools?.length
    ? def.capabilities.tools.map(t => ({
        toolName: t.dshToolName,
        adapterId: def.id,
        adapterName: def.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        estimatedCredits: t.estimatedCredits ?? 0,
        timeoutMs: t.timeoutMs ?? 0,
        enabled,
      }))
    : undefined;
  return {
    id: def.id,
    name: def.name,
    vendor: def.vendor,
    description: def.description,
    icon: (def as any).icon,
    officialDoc: def.officialDoc,
    installHint: def.installHint,
    defaultEnabled: def.defaultEnabled !== false,
    fingerprint: {
      commandNames: def.fingerprint.commandNames,
      versionArgs: def.fingerprint.versionArgs,
      configPaths: def.fingerprint.configPaths,
      envVars: def.fingerprint.envVars,
    },
    capabilities: {
      tools,
      agent: def.capabilities.agent ? {
        protocol: def.capabilities.agent.protocol,
        displayName: def.capabilities.agent.agentMeta?.displayName,
        avatarEmoji: def.capabilities.agent.agentMeta?.avatarEmoji,
        strengths: def.capabilities.agent.agentMeta?.strengths,
        supportsStreaming: def.capabilities.agent.agentMeta?.supportsStreaming,
      } : undefined,
    },
    quota: opts.quota ? projectQuotaRow(def.id, def.name, opts.quota) : null,
    scanInfo: opts.scan ? {
      version: opts.scan.version,
      auth: opts.scan.authState,
      authBadge: authBadge(opts.scan.authState),
      authHint: opts.scan.authHint,
      executablePath: opts.scan.executablePath,
      discoveredAt: opts.scan.scannedDepth ? Date.now() : null,
    } : null,
    enabled,
  };
}

export function buildDashboard(
  lastResult: ScanResult | null,
  adapters: CliAdapterDefinition[],
  sessionsCount: number,
  registryEnabled: (id: string) => boolean,
): UiDashboard {
  const base: UiDashboard = {
    scannedAt: lastResult?.scannedAt ?? null,
    depth: (lastResult?.depth ?? 'l1') as ScanDepth,
    summary: lastResult?.summary ?? {
      total: 0, matched: 0, enabled: 0, authenticated: 0, quotaWarning: 0,
    },
    sessionsCount,
    adaptersTotal: adapters.length,
    adaptersEnabled: adapters.filter(a => registryEnabled(a.id)).length,
  };
  return base;
}

// ============================================================
// Action dispatch (all paths ultimately call this: settings action / component tree / HTTP POST / memory API)
// ============================================================
export async function dispatchUiAction(
  ctx: Context,
  cliHub: any,
  actionId: UiActionId | string,
  payload: any = {},
): Promise<UiActionResult> {
  switch (actionId) {
    case 'scan': {
      const depth: ScanDepth = (payload?.depth as ScanDepth) ?? 'l3';
      const timeoutPerCmd: number | undefined = payload?.timeoutPerCmd;
      const result = await cliHub.scan({ depth, timeoutPerCmd });
      // Sync-update the web cache so dashboard / adapterRows immediately get the latest scan result
      // Shared via cliHub._scanCache (avoids different views instance closures not sharing when web apply is called multiple times)
      try { cliHub.ui?.setCachedResult?.(result); } catch {}
      try { (cliHub as any)._scanCache = result; } catch {}
      return { ok: true, message: `scan(${depth}) completed, matched=${result?.summary?.matched ?? 0}/${result?.summary?.total ?? 0}`, data: result?.summary };
    }
    case 'toggle-adapter': {
      const id: string | undefined = payload?.adapterId;
      const enabled = !!payload?.enabled;
      if (!id) return { ok: false, message: 'adapterId missing' };
      enabled ? cliHub.enable(id) : cliHub.disable(id);
      return { ok: true, message: `${id} → enabled=${enabled}` };
    }
    case 'enable-all-authed': {
      const rows = projectAdapterRows(cliHub.list({ onlyEnabled: false }), {
        registryEnabled: (rid: string) => cliHub.registry?.isEnabled?.(rid) ?? cliHub.list({ onlyEnabled: true }).some((a: any) => a.id === rid),
        scanItems: (await getLastScan(cliHub)) ?? [],
      });
      let count = 0;
      for (const r of rows) if (r.auth === 'authenticated' && !r.enabled) { cliHub.enable(r.id); count++; }
      return { ok: true, message: `Enabled ${count} logged-in adapters` };
    }
    case 'disable-all': {
      for (const a of cliHub.list({ onlyEnabled: true })) cliHub.disable(a.id);
      return { ok: true };
    }
    case 'agent-spawn': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId missing' };
      if (!cliHub.agents?.spawn) return { ok: false, message: 'cliHub.agents does not support spawn' };
      try {
        const session = await cliHub.agents.spawn(id, payload?.options);
        return { ok: true, message: `agent started: ${session?.sessionId ?? id}`, data: session };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'agent-stop': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId missing' };
      try { await cliHub.agents.stop(id); return { ok: true }; }
      catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'agent-stop-all': {
      try { await cliHub.agents.stopAll(); return { ok: true }; }
      catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'agent-send': {
      const id: string | undefined = payload?.adapterId;
      const sessionId: string | undefined = payload?.sessionId;
      const message = payload?.message;
      if (!id) return { ok: false, message: 'adapterId missing' };
      if (message == null) return { ok: false, message: 'message missing' };
      try {
        // Prefer cliHub.agents.getSession(adapterId) to get the full AgentSession (with send method)
        // listSessions returns simplified projection objects (no send method), cannot be used directly
        const session = cliHub.agents?.getSession?.(id);
        if (session && typeof session.send === 'function') {
          await session.send(message);
          return { ok: true, message: `Message sent to session ${session.sessionId}` };
        }
        // fallback: try matching sessionId in listSessions then attempt send
        if (sessionId) {
          const listed = (cliHub.agents?.listSessions?.() ?? []).find((s: any) => s.sessionId === sessionId);
          if (listed && typeof (listed as any).send === 'function') {
            await (listed as any).send(message);
            return { ok: true, message: `Message sent to session ${listed.sessionId}` };
          }
        }
        // Final fallback: call cliHub.agents.send(adapterId, msg) directly if it exists
        if (typeof cliHub.agents?.send === 'function') {
          await cliHub.agents.send(id, message);
          return { ok: true };
        }
        return { ok: false, message: 'No available session.send or cliHub.agents.send method' };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'quota-refresh': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId missing' };
      if (!cliHub.quota?.refresh) return { ok: false, message: 'cliHub.quota does not support refresh' };
      try {
        const q = await cliHub.quota.refresh(id);
        return { ok: true, message: `Quota refresh completed: ${id}`, data: q };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'quota-refresh-all': {
      if (!cliHub.quota?.refreshAll) {
        // Degrade: refresh each enabled adapter individually
        const ids = (cliHub.list?.({ onlyEnabled: true }) ?? []).map((a: any) => a.id);
        const results: any[] = [];
        for (const id of ids) {
          try { if (cliHub.quota?.refresh) results.push(await cliHub.quota.refresh(id)); }
          catch (e: any) { results.push({ adapterId: id, error: String(e?.message ?? e) }); }
        }
        return { ok: true, message: `Refreshed quota for ${results.length} adapters`, data: results };
      }
      try {
        const results = await cliHub.quota.refreshAll();
        return { ok: true, message: 'All quotas refreshed', data: results };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'tool-exec': {
      const toolName: string | undefined = payload?.toolName;
      const input: any = payload?.input ?? {};
      if (!toolName) return { ok: false, message: 'toolName missing' };
      if (!cliHub.tools?.execute) return { ok: false, message: 'cliHub.tools does not support execute' };
      try {
        const result = await cliHub.tools.execute(toolName, input);
        return { ok: true, message: `tool ${toolName} execution completed`, data: result };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'show-install-hint': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId missing' };
      const def = cliHub.registry?.get?.(id);
      if (!def?.installHint) return { ok: false, message: 'No install hint' };
      return { ok: true, message: def.installHint, data: { installHint: def.installHint, officialDoc: def.officialDoc } };
    }
    case 'adapter-detail': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId missing' };
      const def = cliHub.registry?.get?.(id);
      if (!def) return { ok: false, message: `Adapter not found: ${id}` };
      const scanItems = (await getLastScan(cliHub)) ?? [];
      const scan = scanItems.find((s: any) => s.adapterId === id) ?? null;
      let quota: any = null;
      try { if (cliHub.quota?.get) quota = await cliHub.quota.get(id); } catch {}
      const detail = projectAdapterDetail(def, {
        registryEnabled: (rid: string) => cliHub.registry?.isEnabled?.(rid) ?? false,
        scan,
        quota,
      });
      return { ok: true, message: `Adapter details: ${id}`, data: detail };
    }
    default:
      return { ok: false, message: `Unknown action: ${actionId}` };
  }
}

async function getLastScan(cliHub: any): Promise<ScanItem[] | null> {
  try {
    // Try storage.loadLastScan first (fast in-memory path); if unavailable, use cliHub.scan cached
    const last = await (cliHub as any).scanner?._lastScan
      ?? (await (cliHub as any).storage?.loadLastScan?.())
      ?? null;
    if (last && Array.isArray(last.items)) return last.items;
    if (last && Array.isArray(last)) return last;
  } catch {}
  return null;
}

// ============================================================
// View functions (shared by settings/clientPages/HTTP)
// ============================================================
interface UiViews {
  getLastScanOrCached: () => Promise<ScanResult | null>;
  getDashboard: () => Promise<UiDashboard>;
  getScannerRows: (depth?: ScanDepth, timeoutPerCmd?: number) => Promise<UiScannerRow[]>;
  getAdapterRows: () => Promise<UiAdapterRow[]>;
  getSessionRows: () => Promise<UiSessionRow[]>;
  getQuotaRows: () => Promise<UiQuotaRow[]>;
  getToolRows: () => Promise<UiToolRow[]>;
  getAdapterDetail: (adapterId: string) => Promise<UiAdapterDetail | null>;
}

function createViews(ctx: Context, cliHub: any): UiViews {
  const registryGet = (id: string) => (cliHub.registry?.get?.(id) ?? undefined) as CliAdapterDefinition | undefined;
  const registryEnabled = (id: string) => {
    if (cliHub.registry?.isEnabled?.(id) !== undefined) return cliHub.registry.isEnabled(id);
    return (cliHub.list?.({ onlyEnabled: true }) ?? []).some((a: any) => a.id === id);
  };

  async function scanAndCache(depth: ScanDepth = 'l3', timeoutPerCmd?: number): Promise<ScanResult> {
    return cliHub.scan({ depth, timeoutPerCmd });
  }

  let lastCachedResult: ScanResult | null = null;
  // Attach the cache to cliHub to avoid different views instance closures not sharing when web apply is called multiple times
  if (!(cliHub as any)._scanCache) (cliHub as any)._scanCache = null;
  const getLastScanOrCached: UiViews['getLastScanOrCached'] = async () => {
    // Read cliHub._scanCache first (shared across views instances), fallback to this closure's lastCachedResult
    const shared = (cliHub as any)._scanCache;
    if (shared) return shared;
    if (lastCachedResult) return lastCachedResult;
    try {
      const stored = await (cliHub.scanner as any)?._storage?.loadLastScan?.()
        ?? await (cliHub as any).storage?.loadLastScan?.();
      if (stored) {
        const items: ScanItem[] = Array.isArray(stored) ? stored : stored.items;
        lastCachedResult = {
          scannedAt: stored.ts ?? Date.now(),
          depth: 'l3',
          items,
          summary: {
            total: items.length,
            matched: items.filter(i => i.adapterId).length,
            enabled: items.filter(i => i.adapterId && registryEnabled(i.adapterId)).length,
            authenticated: items.filter(i => i.authState === 'authenticated').length,
            quotaWarning: 0,
          },
        };
      }
    } catch {}
    return lastCachedResult;
  };

  async function getQuotaFor(adapterId: string): Promise<any | null> {
    try {
      // Compatible with multiple API shapes: cliHub.quota.get(id) / cliHub.quota.snapshot(id) / cache lookup
      if (cliHub.quota?.get) return await cliHub.quota.get(adapterId);
      if (cliHub.quota?.snapshot) return await cliHub.quota.snapshot(adapterId);
      if (cliHub.quota?.cache?.get) return cliHub.quota.cache.get(adapterId);
    } catch {}
    return null;
  }

  return {
    getLastScanOrCached,
    async getDashboard() {
      const adapters: CliAdapterDefinition[] = cliHub.list?.({ onlyEnabled: false }) ?? [];
      const sessionsCount: number = cliHub.agents?.listSessions?.().length ?? 0;
      const last = await getLastScanOrCached();
      return buildDashboard(last, adapters, sessionsCount, registryEnabled);
    },
    async getScannerRows(depth = 'l3', timeoutPerCmd) {
      const result = await scanAndCache(depth, timeoutPerCmd);
      lastCachedResult = result;
      return projectScannerRows(result.items, { registryGet, registryEnabled });
    },
    async getAdapterRows() {
      const adapters: CliAdapterDefinition[] = cliHub.list?.({ onlyEnabled: false }) ?? [];
      const last = await getLastScanOrCached();
      return projectAdapterRows(adapters, { registryEnabled, scanItems: last?.items ?? null });
    },
    async getSessionRows() {
      const sessions = cliHub.agents?.listSessions?.() ?? [];
      return projectSessionRows(sessions, registryGet);
    },
    async getQuotaRows() {
      const adapters: CliAdapterDefinition[] = cliHub.list?.({ onlyEnabled: true }) ?? cliHub.list?.({ onlyEnabled: false }) ?? [];
      const rows: UiQuotaRow[] = [];
      for (const def of adapters) {
        const q = await getQuotaFor(def.id);
        if (q) rows.push(projectQuotaRow(def.id, def.name, q));
      }
      return rows;
    },
    async getToolRows() {
      const adapters: CliAdapterDefinition[] = cliHub.list?.({ onlyEnabled: false }) ?? [];
      const last = await getLastScanOrCached();
      return projectToolRows(adapters, { registryEnabled, scanItems: last?.items ?? null });
    },
    async getAdapterDetail(adapterId: string) {
      const def = registryGet(adapterId);
      if (!def) return null;
      const last = await getLastScanOrCached();
      const scan = (last?.items ?? []).find(s => s.adapterId === adapterId) ?? null;
      const quota = await getQuotaFor(adapterId);
      return projectAdapterDetail(def, { registryEnabled, scan, quota });
    },
    setCachedResult(result: ScanResult | null) {
      lastCachedResult = result;
      (cliHub as any)._scanCache = result;
    },
  } as UiViews & { setCachedResult: (r: ScanResult | null) => void };
}

// ============================================================
// Settings path A
// ============================================================
function mountSettingsPath(ctx: Context, cliHub: any, views: UiViews, log: any, settings?: any): boolean {
  // Parameter takes priority (from safeGet); fallback also reads once via safeGet (keeps direct ctx.settings reads working in headless environments during unit tests)
  const $settings = settings ?? (() => { try { return safeGet(ctx, 'settings'); } catch { return undefined; } })();
  if (!$settings || typeof $settings.registerSection !== 'function') return false;
  try {
    $settings.registerSection({
      id: 'cli-hub',
      title: 'CLI Hub',
      icon: 'terminal',
      // If the settings protocol supports the onAction callback, dispatch directly
      onAction:
        $settings._supportsOnAction !== false
          ? async (actionId: string, payload: any) => dispatchUiAction(ctx, cliHub, actionId, payload)
          : undefined,
      render: () => ({
        sections: [
          // --- Dashboard summary ---
          {
            title: 'Overview',
            description: 'Local AI CLI integration and quota usage statistics',
            headerActions: [
              { id: 'scan', label: 'Quick scan (L1)', variant: 'default', payload: { depth: 'l1' } },
              { id: 'quota-refresh-all', label: 'Refresh all quotas', variant: 'primary' },
            ],
            refresh: async () => views.getDashboard(),
          },
          // --- Scanner discovered ---
          {
            title: 'Discovered AI CLIs',
            description: 'L3 scan invokes the auth status of each CLI to verify login state (network requests, ~several seconds).',
            headerActions: [
              { id: 'scan', label: 'Rescan (L3)', variant: 'primary', payload: { depth: 'l3' } },
              { id: 'scan', label: 'Quick scan (L1)', variant: 'default', payload: { depth: 'l1' } },
            ],
            columns: [
              { key: 'displayName', label: 'Name' },
              { key: 'version', label: 'Version' },
              { key: 'authBadge', label: 'Login' },
              { key: 'capabilities', label: 'Capabilities' },
              { key: 'enabled', label: 'Enabled' },
              { key: 'executablePath', label: 'Install path' },
            ],
            refresh: async (payload: any) => {
              const depth: ScanDepth = (payload?.depth as ScanDepth) ?? 'l3';
              const timeoutPerCmd: number | undefined = payload?.timeoutPerCmd;
              return views.getScannerRows(depth, timeoutPerCmd);
            },
          },
          // --- Adapter inventory (including not installed) ---
          {
            title: 'Adapter toggles (all built-in)',
            description: 'Disabling also stops running Agent subprocesses and unregisters the tools of that CLI from the DSH tool table. Click "Details" to expand full adapter info.',
            headerActions: [
              { id: 'enable-all-authed', label: 'Enable all logged-in', variant: 'primary' },
              { id: 'disable-all', label: 'Disable all', variant: 'danger' },
            ],
            columns: [
              { key: 'name', label: 'Adapter' },
              { key: 'discovered', label: 'Installed' },
              { key: 'version', label: 'Detected version' },
              { key: 'authBadge', label: 'Login' },
              { key: 'capabilities', label: 'Capabilities' },
              { key: 'enabled', label: 'Enabled' },
            ],
            refresh: async () => views.getAdapterRows(),
          },
          // --- Quota monitoring ---
          {
            title: 'Quota monitoring',
            description: 'Quota usage of each enabled adapter. Click "Refresh" to re-fetch (calls the CLI or HTTP).',
            headerActions: [
              { id: 'quota-refresh-all', label: 'Refresh all quotas', variant: 'primary' },
            ],
            columns: [
              { key: 'adapterName', label: 'Adapter' },
              { key: 'used', label: 'Used' },
              { key: 'total', label: 'Total quota' },
              { key: 'percent', label: 'Usage (%)' },
              { key: 'currency', label: 'Unit' },
              { key: 'refreshedAt', label: 'Refreshed at' },
            ],
            refresh: async () => views.getQuotaRows(),
          },
          // --- Tool list (discovered + authenticated CLI tools) ---
          {
            title: 'Available tools',
            description: 'Tools that discovered and authenticated CLIs expose to the DSH agent. Click "Execute" to test a tool call.',
            columns: [
              { key: 'toolName', label: 'Tool name' },
              { key: 'adapterName', label: 'Source' },
              { key: 'description', label: 'Description' },
              { key: 'estimatedCredits', label: 'Estimated credits' },
              { key: 'enabled', label: 'Enabled' },
            ],
            refresh: async () => views.getToolRows(),
          },
          // --- Agent sessions ---
          {
            title: 'Agent sessions',
            description: 'Long-lived sub-Agent processes; click "Stop" for graceful shutdown (SIGINT → grace → SIGKILL).',
            headerActions: [{ id: 'agent-stop-all', label: 'Stop all', variant: 'danger' }],
            columns: [
              { key: 'adapterName', label: 'Adapter' },
              { key: 'pid', label: 'PID' },
              { key: 'status', label: 'Status' },
              { key: 'durationMs', label: 'Uptime (ms)' },
            ],
            refresh: async () => views.getSessionRows(),
          },
        ],
      }),
    });
    log?.debug?.('registered settings section: cli-hub');
    return true;
  } catch (e: any) {
    log?.warn?.('register settings section failed:', e?.message ?? e);
    return false;
  }
}

// ============================================================
// ClientPages path B
// ============================================================
function mountClientPagesPath(ctx: Context, cliHub: any, views: UiViews, log: any, clientPages?: any): boolean {
  const $clientPages = clientPages ?? (() => { try { return safeGet(ctx, 'clientPages'); } catch { return undefined; } })();
  if (!$clientPages || typeof $clientPages.register !== 'function') return false;
  try {
    // The real DSH protocol is unknown; we use a "server-driven component tree" description and attach an action dispatcher
    // If the DSH runtime does not accept the componentTree field, fall back to placeholder but panel.meta provides the HTTP API entry
    const panel = {
      kind: 'component-tree',
      meta: {
        description: 'CLI Hub Dashboard + Scanner table + Adapter toggles + quota monitoring + tool list + Agent sessions',
        restFallback: {
          dashboard: '/plugins/cli-hub/api/dashboard',
          adapters: '/plugins/cli-hub/api/adapters',
          scan: '/plugins/cli-hub/api/scan',
          quota: '/plugins/cli-hub/api/quota',
          tools: '/plugins/cli-hub/api/tools',
          sessions: '/plugins/cli-hub/api/agents/sessions',
          adapterDetail: '/plugins/cli-hub/api/adapters/:id',
          actions: '/plugins/cli-hub/api/action',
          events: '/plugins/cli-hub/api/events',
        },
      },
      async hydrate() {
        const [dashboard, rows, adapters, quota, tools, sessions] = await Promise.all([
          views.getDashboard(),
          views.getScannerRows('l3'),
          views.getAdapterRows(),
          views.getQuotaRows(),
          views.getToolRows(),
          views.getSessionRows(),
        ]);
        return {
          type: 'page',
          route: '/cli-hub',
          children: [
            { type: 'dashboard', data: dashboard, actions: [
              { id: 'scan', label: 'Rescan', variant: 'primary', payload: { depth: 'l3' } },
              { id: 'quota-refresh-all', label: 'Refresh all quotas', variant: 'default' },
            ] },
            { type: 'table', title: 'Discovered CLIs', columns: rows.length ? Object.keys(rows[0]).filter(k => k !== 'actions') : [], rows, rowActions: 'actions' },
            { type: 'table', title: 'Adapter toggles', columns: adapters.length ? Object.keys(adapters[0]).filter(k => k !== 'actions') : [], rows: adapters, rowActions: 'actions', expandable: { actionId: 'adapter-detail', keyField: 'id' } },
            { type: 'table', title: 'Quota monitoring', columns: quota.length ? Object.keys(quota[0]) : [], rows: quota, rowActions: [{ id: 'quota-refresh', label: 'Refresh', variant: 'default', payloadKey: 'adapterId' }] },
            { type: 'table', title: 'Available tools', columns: tools.length ? Object.keys(tools[0]).filter(k => k !== 'inputSchema') : [], rows: tools, rowActions: [{ id: 'tool-exec', label: 'Execute', variant: 'primary', payloadKey: 'toolName' }] },
            { type: 'table', title: 'Agent sessions', columns: sessions.length ? Object.keys(sessions[0]).filter(k => k !== 'actions') : [], rows: sessions, rowActions: 'actions' },
          ],
        };
      },
    };
    $clientPages.register({
      id: 'cli-hub',
      title: 'CLI Hub',
      route: '/cli-hub',
      icon: 'terminal',
      panel,
    });
    log?.debug?.('registered client page: /cli-hub');
    return true;
  } catch (e: any) {
    log?.warn?.('register client page failed:', e?.message ?? e);
    return false;
  }
}

// ============================================================
// HTTP fallback path C (ctx.webServer / ctx.http / ctx.router)
// DSH officially uses the `webServer` service of `@deepseek-ai/dsh-host-webserver`,
// with the protocol: webServer.register({ kind: "exact" | "prefix", path, method?, handler(req,res) }).
// If webServer is unavailable (tests / older DSH), fall back to ctx.http / ctx.router style.
// ============================================================
function mountHttpPath(
  ctx: Context,
  cliHub: any,
  views: UiViews,
  log: any,
  http?: any,
  router?: any,
  webServer?: any,
): boolean {
  const $http = http ?? (() => { try { return safeGet(ctx, 'http'); } catch { return undefined; } })();
  const $router = router ?? (() => { try { return safeGet(ctx, 'router'); } catch { return undefined; } })();
  const $webServer = webServer ?? (() => { try { return safeGet(ctx, 'webServer'); } catch { return undefined; } })();

  // Method route wrapper: if the route does not declare a method, filter inside the handler
  const withMethod = (method: 'GET' | 'POST', handler: (req: any, res: any) => any) =>
    (req: any, res: any) => {
      const m = (req?.method ?? 'GET').toUpperCase();
      if (m !== method) {
        try {
          if (res?.writeHead && typeof res.end === 'function') {
            res.writeHead(405, { Allow: method }); res.end();
          }
        } catch {}
        return;
      }
      return handler(req, res);
    };

  // ------- Approach 1: DSH webServer.register (preferred) -------
  if ($webServer && typeof $webServer.register === 'function') {
    const reg = (kind: 'exact' | 'prefix', method: 'GET' | 'POST', path: string, handler: (r: any, s: any) => any) => {
      try {
        $webServer.register({
          kind,
          path,
          method: method.toUpperCase(),
          handler: withMethod(method, handler),
        } as any);
        return true;
      } catch (e: any) {
        log?.warn?.(`webServer.register ${path} failed:`, e?.message ?? e);
        return false;
      }
    };

    const routes = [
      // ---- Dashboard HTML page: exact routes (must NOT be 'prefix', or /cli-hub would swallow /cli-hub/api/*) ----
      reg('exact', 'GET', '/cli-hub', async (req, res) => sendHtml(res, 200, DASHBOARD_HTML)),
      reg('exact', 'GET', '/plugins/cli-hub/page', async (req, res) => sendHtml(res, 200, DASHBOARD_HTML)),
      reg('prefix', 'GET', '/plugins/cli-hub/api/dashboard', async (req, res) => send(res, 200, await views.getDashboard())),
      reg('prefix', 'GET', '/cli-hub/api/dashboard', async (req, res) => send(res, 200, await views.getDashboard())),
      // adapters list + detail merged into a single prefix route (avoids duplicate path errors):
      //   GET /cli-hub/api/adapters            → list
      //   GET /cli-hub/api/adapters/<id>       → detail
      //   GET /cli-hub/api/adapters/<id>/quota → refresh quota for adapter
      reg('prefix', 'GET', '/plugins/cli-hub/api/adapters', async (req, res) => {
        const url = req?.url ?? '';
        const afterPrefix = url.replace(/^\/plugins\/cli-hub\/api\/adapters/, '').replace(/^\//, '');
        if (!afterPrefix) return send(res, 200, await views.getAdapterRows());
        const segments = afterPrefix.split('/').filter(Boolean);
        const id = segments[0];
        if (!id) return send(res, 404, { error: 'adapter id required' });
        const last = segments[segments.length - 1];
        if (last === 'quota') {
          const result = await dispatchUiAction(ctx, cliHub, 'quota-refresh', { adapterId: id });
          return send(res, result.ok ? 200 : 400, result);
        }
        const detail = await views.getAdapterDetail(id);
        if (!detail) return send(res, 404, { error: `adapter ${id} not found` });
        return send(res, 200, detail);
      }),
      reg('prefix', 'GET', '/cli-hub/api/adapters', async (req, res) => {
        const url = req?.url ?? '';
        const afterPrefix = url.replace(/^\/cli-hub\/api\/adapters/, '').replace(/^\//, '');
        if (!afterPrefix) return send(res, 200, await views.getAdapterRows());
        const segments = afterPrefix.split('/').filter(Boolean);
        const id = segments[0];
        if (!id) return send(res, 404, { error: 'adapter id required' });
        const last = segments[segments.length - 1];
        if (last === 'quota') {
          const result = await dispatchUiAction(ctx, cliHub, 'quota-refresh', { adapterId: id });
          return send(res, result.ok ? 200 : 400, result);
        }
        const detail = await views.getAdapterDetail(id);
        if (!detail) return send(res, 404, { error: `adapter ${id} not found` });
        return send(res, 200, detail);
      }),
      reg('prefix', 'GET', '/plugins/cli-hub/api/scan', async (req, res) => {
        const query = (req?.query ?? (req.url ? parseQueryFromUrl(req.url) : {})) as any;
        const depth: ScanDepth = (query.depth as ScanDepth) ?? 'l3';
        const timeoutPerCmd = query.timeoutPerCmd ? Number(query.timeoutPerCmd) : undefined;
        return send(res, 200, await views.getScannerRows(depth, timeoutPerCmd));
      }),
      reg('prefix', 'GET', '/cli-hub/api/scan', async (req, res) => {
        const query = (req?.query ?? (req.url ? parseQueryFromUrl(req.url) : {})) as any;
        const depth: ScanDepth = (query.depth as ScanDepth) ?? 'l3';
        const timeoutPerCmd = query.timeoutPerCmd ? Number(query.timeoutPerCmd) : undefined;
        return send(res, 200, await views.getScannerRows(depth, timeoutPerCmd));
      }),
      reg('prefix', 'GET', '/plugins/cli-hub/api/quota', async (req, res) => send(res, 200, await views.getQuotaRows())),
      reg('prefix', 'GET', '/cli-hub/api/quota', async (req, res) => send(res, 200, await views.getQuotaRows())),
      reg('prefix', 'GET', '/plugins/cli-hub/api/tools', async (req, res) => send(res, 200, await views.getToolRows())),
      reg('prefix', 'GET', '/cli-hub/api/tools', async (req, res) => send(res, 200, await views.getToolRows())),
      reg('prefix', 'GET', '/plugins/cli-hub/api/agents/sessions', async (req, res) => send(res, 200, await views.getSessionRows())),
      reg('prefix', 'GET', '/cli-hub/api/agents/sessions', async (req, res) => send(res, 200, await views.getSessionRows())),
      reg('prefix', 'POST', '/plugins/cli-hub/api/agents/spawn', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'agent-spawn', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/cli-hub/api/agents/spawn', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'agent-spawn', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/plugins/cli-hub/api/agents/send', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'agent-send', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/cli-hub/api/agents/send', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'agent-send', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/plugins/cli-hub/api/tools/exec', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'tool-exec', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/cli-hub/api/tools/exec', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, 'tool-exec', body);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'GET', '/plugins/cli-hub/api/events', async (req, res) => handleSse(req, res, cliHub, log)),
      reg('prefix', 'GET', '/cli-hub/api/events', async (req, res) => handleSse(req, res, cliHub, log)),
      reg('prefix', 'POST', '/plugins/cli-hub/api/action', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, body?.id, body?.payload);
        return send(res, result.ok ? 200 : 400, result);
      }),
      reg('prefix', 'POST', '/cli-hub/api/action', async (req, res) => {
        const body = await readJsonBody(req);
        const result = await dispatchUiAction(ctx, cliHub, body?.id, body?.payload);
        return send(res, result.ok ? 200 : 400, result);
      }),
    ];

    if (routes.some(Boolean)) {
      log?.info?.(`registered HTTP routes via webServer (ok=${routes.filter(Boolean).length}/${routes.length}): /plugins/cli-hub/api/* + /cli-hub/api/*`);
      return true;
    }
  }

  // ------- Approach 2: $http.get / $router.get etc. (if DSH uses another server plugin) -------
  const registerOldStyle = (method: 'get' | 'post', route: string, handler: (req: any, res?: any) => any) => {
    const tryTargets: Array<[obj: any, fnName: string, argsMapper: (r: any) => [string, any]]> = [
      [$http, method.toLowerCase(), (h) => [route, h]],
      [$router, method.toLowerCase(), (h) => [route, h]],
    ];
    for (const [obj, fn, argsMapper] of tryTargets) {
      if (obj && typeof obj[fn] === 'function') {
        try {
          const args = argsMapper(handler as any);
          (obj[fn] as any)(...args);
          return true;
        } catch { /* try next */ }
      }
    }
    return false;
  };

  const routesOk = [
    registerOldStyle('get', '/plugins/cli-hub/api/dashboard', async (_req, res) => send(res, 200, await views.getDashboard())),
    registerOldStyle('get', '/cli-hub/api/dashboard', async (_req, res) => send(res, 200, await views.getDashboard())),
    registerOldStyle('get', '/cli-hub', async (_req, res) => sendHtml(res, 200, DASHBOARD_HTML)),
    registerOldStyle('get', '/plugins/cli-hub/api/adapters', async (_req, res) => send(res, 200, await views.getAdapterRows())),
    registerOldStyle('get', '/cli-hub/api/adapters', async (_req, res) => send(res, 200, await views.getAdapterRows())),
    registerOldStyle('get', '/plugins/cli-hub/api/adapters/:id', async (req, res) => {
      const id = req?.params?.id ?? extractAdapterIdFromUrl(req?.url ?? '', '/adapters/');
      if (!id) return send(res, 404, { error: 'adapter id required' });
      const detail = await views.getAdapterDetail(id);
      if (!detail) return send(res, 404, { error: `adapter ${id} not found` });
      return send(res, 200, detail);
    }),
    registerOldStyle('get', '/cli-hub/api/adapters/:id', async (req, res) => {
      const id = req?.params?.id ?? extractAdapterIdFromUrl(req?.url ?? '', '/adapters/');
      if (!id) return send(res, 404, { error: 'adapter id required' });
      const detail = await views.getAdapterDetail(id);
      if (!detail) return send(res, 404, { error: `adapter ${id} not found` });
      return send(res, 200, detail);
    }),
    registerOldStyle('get', '/plugins/cli-hub/api/scan', async (req, res) => {
      const query = (req?.query ?? req?.params ?? (req.url ? parseQueryFromUrl(req.url) : {})) as any;
      const depth: ScanDepth = (query.depth as ScanDepth) ?? 'l3';
      const timeoutPerCmd = query.timeoutPerCmd ? Number(query.timeoutPerCmd) : undefined;
      const rows = await views.getScannerRows(depth, timeoutPerCmd);
      return send(res, 200, rows);
    }),
    registerOldStyle('get', '/cli-hub/api/scan', async (req, res) => {
      const query = (req?.query ?? req?.params ?? (req.url ? parseQueryFromUrl(req.url) : {})) as any;
      const depth: ScanDepth = (query.depth as ScanDepth) ?? 'l3';
      const timeoutPerCmd = query.timeoutPerCmd ? Number(query.timeoutPerCmd) : undefined;
      return send(res, 200, await views.getScannerRows(depth, timeoutPerCmd));
    }),
    registerOldStyle('get', '/plugins/cli-hub/api/quota', async (_req, res) => send(res, 200, await views.getQuotaRows())),
    registerOldStyle('get', '/cli-hub/api/quota', async (_req, res) => send(res, 200, await views.getQuotaRows())),
    registerOldStyle('get', '/plugins/cli-hub/api/tools', async (_req, res) => send(res, 200, await views.getToolRows())),
    registerOldStyle('get', '/cli-hub/api/tools', async (_req, res) => send(res, 200, await views.getToolRows())),
    registerOldStyle('get', '/plugins/cli-hub/api/agents/sessions', async (_req, res) => send(res, 200, await views.getSessionRows())),
    registerOldStyle('get', '/cli-hub/api/agents/sessions', async (_req, res) => send(res, 200, await views.getSessionRows())),
    registerOldStyle('post', '/plugins/cli-hub/api/agents/spawn', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'agent-spawn', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/cli-hub/api/agents/spawn', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'agent-spawn', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/plugins/cli-hub/api/agents/send', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'agent-send', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/cli-hub/api/agents/send', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'agent-send', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/plugins/cli-hub/api/tools/exec', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'tool-exec', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/cli-hub/api/tools/exec', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, 'tool-exec', body);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('get', '/plugins/cli-hub/api/events', async (req, res) => handleSse(req, res, cliHub, log)),
    registerOldStyle('get', '/cli-hub/api/events', async (req, res) => handleSse(req, res, cliHub, log)),
    registerOldStyle('post', '/plugins/cli-hub/api/action', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, body?.id, body?.payload);
      return send(res, result.ok ? 200 : 400, result);
    }),
    registerOldStyle('post', '/cli-hub/api/action', async (req, res) => {
      const body = req?.body ?? await readJsonBody(req) ?? (req as any);
      const result = await dispatchUiAction(ctx, cliHub, body?.id, body?.payload);
      return send(res, result.ok ? 200 : 400, result);
    }),
  ];

  if (routesOk.every(Boolean)) {
    log?.debug?.('registered HTTP JSON API: /plugins/cli-hub/api/* + /cli-hub/api/*');
    return true;
  }
  if (routesOk.some(Boolean)) {
    log?.debug?.('registered partial HTTP API (some prefixes)');
    return true;
  }
  return false;
}

/** Generic JSON response sender: compatible with Express/Koa/native http response styles. */
function send(res: any, code: number, json: any) {
  const payload = JSON.stringify(json);
  if (res && typeof res === 'object') {
    if (typeof res.status === 'function' && typeof res.json === 'function') { try { res.status(code).json(json); return; } catch {} }
    if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
      try { res.setHeader('Content-Type', 'application/json'); res.statusCode = code; res.end(payload); return; } catch {}
    }
    if (typeof res.send === 'function') { try { res.send({ status: code, body: payload, headers: { 'Content-Type': 'application/json' } }); return; } catch {} }
  }
  return json;
}

function sendHtml(res: any, code: number, html: string) {
  const body = String(html);
  if (res && typeof res === 'object') {
    if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
      try { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); return; } catch {}
    }
    if (typeof res.setHeader === 'function' && typeof res.end === 'function') {
      try { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.statusCode = code; res.end(body); return; } catch {}
    }
    if (typeof res.send === 'function') { try { res.send(body); return; } catch {} }
  }
}

/** Parse query string from a node:http IncomingMessage (the webServer protocol does not go through Koa query). */
function parseQueryFromUrl(rawUrl: string): Record<string, string> {
  try {
    const u = new URL(rawUrl, 'http://x');
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch { return {}; }
}

/** Extract the id part of /adapters/<id> from a url (tolerates a query after ?). */
function extractAdapterIdFromUrl(rawUrl: string, marker: string): string | null {
  try {
    const pathOnly = rawUrl.split('?')[0];
    const idx = pathOnly.indexOf(marker);
    if (idx < 0) return null;
    const after = pathOnly.slice(idx + marker.length);
    // after looks like "<id>" or "<id>/quota"
    const segments = after.split('/').filter(Boolean);
    return segments[0] ?? null;
  } catch { return null; }
}

/** Read JSON body from an IncomingMessage (DSH webServer does not auto-parse the body). */
async function readJsonBody(req: any): Promise<any> {
  try {
    if (req?.body !== null && req?.body !== undefined) return req.body;
    if (typeof req?.on !== 'function') return undefined;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch { return undefined; }
}

/**
 * SSE long connection: streams the cliHub progress ring + cliHub.on events to the frontend.
 * Protocol: Content-Type: text/event-stream, each message `data: <json>\n\n`.
 * The connection auto-disconnects after 5 minutes (the frontend can reconnect); during that time
 * events emitted by cliHub are pushed into progressRing by subscribeEvents and drained/pushed by this function.
 */
async function handleSse(req: any, res: any, cliHub: any, log: any) {
  // Only supports native IncomingMessage style (res.writeHead + res.write)
  if (!res || typeof res.writeHead !== 'function' || typeof res.write !== 'function') {
    // Koa-style fallback: return a one-shot drained JSON (non-streaming)
    const events = cliHub?.ui?.drainEvents?.() ?? [];
    return send(res, 200, { events, note: 'SSE not supported on this server shape; returning buffered events' });
  }
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

    // Use drainEvents from the cliHub.ui in-memory API as the event source; if absent, degrade to a heartbeat
    const drain = () => {
      try {
        const events = cliHub?.ui?.drainEvents?.() ?? [];
        for (const e of events) {
          res.write(`data: ${JSON.stringify(e)}\n\n`);
        }
      } catch (e: any) {
        log?.warn?.('sse drain error:', e?.message ?? e);
      }
    };
    const drainTimer: any = setInterval(drain, 1000);
    // Auto-disconnect after 5-minute timeout (frontend can reconnect)
    const maxAgeTimer: any = setTimeout(() => {
      try { res.write(`data: ${JSON.stringify({ type: 'close', reason: 'max-age' })}\n\n`); } catch {}
      try { clearInterval(drainTimer); } catch {}
      try { res.end(); } catch {}
    }, 5 * 60 * 1000);

    // Cleanup on client disconnect
    const cleanup = () => {
      try { clearInterval(drainTimer); } catch {}
      try { clearTimeout(maxAgeTimer); } catch {}
    };
    if (typeof req?.on === 'function') {
      req.on('close', cleanup);
      req.on('error', cleanup);
    }
    if (typeof res?.on === 'function') {
      res.on('close', cleanup);
      res.on('error', cleanup);
    }
  } catch (e: any) {
    log?.warn?.('sse setup failed:', e?.message ?? e);
    try { send(res, 500, { error: 'sse setup failed' }); } catch {}
  }
}

// ============================================================
// Event subscription + in-memory API fallback
// ============================================================
function subscribeEvents(
  ctx: Context,
  cliHub: any,
  progressRing: { push: (e: any) => void },
  log: any,
  injected: { $on?: any; $addEventListener?: any } = {},
) {
  const on = (evt: string, cb: (p: any) => void) => {
    try {
      if (typeof injected.$on === 'function') { injected.$on(evt, cb); return true; }
      if (typeof injected.$addEventListener === 'function') { injected.$addEventListener(evt, cb); return true; }
    } catch {}
    return false;
  };
  on('cli-hub/scan-progress', (p) => progressRing.push({ type: 'scan-progress', ts: Date.now(), data: p }));
  on('cli-hub/cli-enabled', (p) => progressRing.push({ type: 'adapter-enabled', ts: Date.now(), data: p }));
  on('cli-hub/cli-disabled', (p) => progressRing.push({ type: 'adapter-disabled', ts: Date.now(), data: p }));
  on('cli-hub/agent-spawned', (p) => progressRing.push({ type: 'agent-spawned', ts: Date.now(), data: p }));
  on('cli-hub/agent-shutdown', (p) => progressRing.push({ type: 'agent-shutdown', ts: Date.now(), data: p }));
  on('cli-hub/quota-warning', (p) => progressRing.push({ type: 'quota-warning', ts: Date.now(), data: p }));
  // UI action bus (when the settings protocol has no onAction, the frontend can emit this event to trigger actions)
  on('cli-hub/ui-action', async ({ id, payload }: any) => {
    try { await dispatchUiAction(ctx, cliHub, id, payload); }
    catch (e: any) { log?.warn?.('ui-action dispatch failed:', e?.message ?? e); }
  });
}

function createMemoryUiApi(cliHub: any, views: UiViews & { setCachedResult?: (r: ScanResult | null) => void }, ctx: Context, progressRing: { drain: () => any[] }) {
  return {
    getDashboard: () => views.getDashboard(),
    getScannerRows: (depth?: ScanDepth, timeoutPerCmd?: number) => views.getScannerRows(depth, timeoutPerCmd),
    getAdapterRows: () => views.getAdapterRows(),
    getAdapterDetail: (adapterId: string) => views.getAdapterDetail(adapterId),
    getSessionRows: () => views.getSessionRows(),
    getQuotaRows: () => views.getQuotaRows(),
    getToolRows: () => views.getToolRows(),
    dispatch: (id: string, payload?: any) => dispatchUiAction(ctx, cliHub, id, payload),
    /** Sync-update the views scan cache (lets the dashboard get the latest result immediately after a scan action call) */
    setCachedResult: (r: ScanResult | null) => views.setCachedResult?.(r),
    /** Event ring buffer: all events since the last drain (for ui polling) */
    drainEvents: () => progressRing.drain(),
  };
}

// Simple ring buffer (max 50 entries, drain clears all)
function makeRing(size = 50) {
  const buf: any[] = [];
  return {
    push(e: any) { buf.push(e); if (buf.length > size) buf.shift(); },
    drain() { const out = buf.slice(); buf.length = 0; return out; },
  };
}

// ============================================================
// apply entry
// ============================================================
export function apply(ctx: Context, cfg: any = undefined, _cliHub3rd: any = undefined) {
  // inject=[]: fiber activates immediately (no dependency on the webServer service); HTTP routes are mounted after deferred polling via safeGet obtains webServer.
  // This way in pure CLI mode (dsh cli-hub list etc.) the plugin won't stay pending due to a missing webServer.
  const $logger      = safeGet(ctx, 'logger');
  const $settings    = safeGet(ctx, 'settings');
  const $clientPages = safeGet(ctx, 'clientPages');
  const $http        = safeGet(ctx, 'http');
  const $router      = safeGet(ctx, 'router');
  let $webServer     = safeGet(ctx, 'webServer');
  const $set         = safeGet(ctx, 'set');
  const $on          = safeGet(ctx, 'on');
  const $addEventListener = safeGet(ctx, 'addEventListener');

  const log = (typeof $logger === 'function' ? $logger(name) : undefined) ?? {
    debug: (...a: any[]) => process.env.DSH_VERBOSE && console.debug('[cli-hub/web]', ...a),
    info: (...a: any[]) => console.info('[cli-hub/web]', ...a),
    warn: (...a: any[]) => console.warn('[cli-hub/web]', ...a),
    error: (...a: any[]) => console.error('[cli-hub/web]', ...a),
  } as any;

  // Mount priority (strongest to weakest reliability):
  //   1) The third argument passed by the main plugin's mountSubPluginDirect (no config/object copying, most reliable)
  //   2) _cliHub written onto the apply function by the main plugin via tagApply
  //   3) cfg._cliHub / cfg.config._cliHub passed via the main plugin's mountSubPlugin config
  //   4) safeGet(ctx,'cliHub') (only visible after the reflect.provide effect, generally only in deferred UI route callbacks)
  const from3rd   = _cliHub3rd;
  const fromApply = (apply as any)?._cliHub;
  const fromCfgA  = (cfg as any)?._cliHub;
  const fromCfgB  = (cfg as any)?.config?._cliHub;
  const fromCtx   = safeGet(ctx, 'cliHub');
  const cliHub: any = from3rd ?? fromApply ?? fromCfgA ?? fromCfgB ?? fromCtx;

  // ------ DSH ctx diagnostics: collect all top-level key names + runtime service names ------
  let ctxKeys: string[] = [];
  let svcKeys: string[] = [];
  let runtimeServicesEntries: Record<string, string> = {};
  let safeGetProbe: Record<string, string> = {};
  try {
    // Path A: ownKeys across multiple ctx shapes
    const candidates = [
      ctx as any,
      (ctx as any)?.internal,
      (ctx as any)?.raw,
      (ctx as any)?.root,
      (ctx as any)?.service,
      (ctx as any)?.services,
      (ctx as any)?.runtime,
      (ctx as any)?.runtime?.services,
      (ctx as any)?.runtime?._services,
      (ctx as any)?.fiber,
      (ctx as any)?.fiber?.runtime,
      (ctx as any)?.fiber?.runtime?.services,
      (ctx as any)?.scope,
      (ctx as any)?.ctx,
    ];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      let keys: string[] = [];
      try { keys = Reflect.ownKeys(c).map(String); } catch {}
      try { if (!keys.length) keys = Object.keys(c); } catch {}
      try {
        if (!keys.length) {
          const acc: string[] = [];
          for (const k in c) { try { acc.push(k); } catch {} if (acc.length > 200) break; }
          keys = acc;
        }
      } catch {}
      if (keys.length) {
        ctxKeys = Array.from(new Set([...ctxKeys, ...keys])).slice(0, 200);
        // Record server-like fields on this object
        for (const k of keys) {
          if (/server|http|router|web|app|koa|listen|port/i.test(k)) {
            const prefix = c === (ctx as any) ? 'ctx' :
              c === (ctx as any)?.runtime ? 'rt' :
                c === (ctx as any)?.runtime?.services ? 'rt.svcs' :
                  c === (ctx as any)?.fiber?.runtime?.services ? 'f.rt.svcs' :
                    c === (ctx as any)?.service ? 'svc' : 'x';
            try {
              let v: any = undefined;
              try { v = (c as any)[k]; } catch {}
              const t = typeof v;
              const flag = (t === 'function' && k === 'register') ? 'fn:register' : t;
              runtimeServicesEntries[`${prefix}.${k}`] = flag;
            } catch {}
          }
        }
      }
    }

    // Path B: reflect.keys (may be named keys/list/entries, try several names)
    try {
      const refAny = (ctx as any).reflect;
      if (refAny && typeof refAny === 'object') {
        for (const mn of ['keys', 'list', 'names', 'getServices', 'entries']) {
          try {
            if (typeof refAny[mn] === 'function') {
              const r = refAny[mn]();
              if (Array.isArray(r)) { svcKeys = Array.from(new Set([...svcKeys, ...r.map(String)])).slice(0, 200); break; }
            }
          } catch {}
        }
      }
    } catch {}

    // Path C: actively probe common web server candidate names via safeGet (case-insensitive)
    const CANDIDATES = [
      'webServer','webserver','web_server','WebServer',
      'server','Server','httpServer','httpserver','HTTPserver',
      'http','HTTP','router','Router','koa','app','serverService','host','listen','webApp',
    ];
    for (const name of CANDIDATES) {
      const v = safeGet(ctx, name);
      if (v !== undefined) safeGetProbe[name] = typeof v + (typeof v === 'object' && v && (('register' in v) ? '|has(register)' : '') + (('get' in v) ? '|has(get)' : ''));
    }
  } catch {}

  if (!cliHub) { log.warn?.('ctx.cliHub not available; web UI skipped.'); return; }

  const views = createViews(ctx, cliHub);
  const progressRing = makeRing(50);
  // Inject $on / $addEventListener via closure (subscribeEvents previously read anyCtx.on internally)
  subscribeEvents(ctx, cliHub, progressRing, log, { $on, $addEventListener });

  const mounted: Array<readonly [string, boolean]> = [];
  const doMount = () => {
    // settings / clientPages: no polling, mount on first availability
    if (!mounted.find(([k]) => k === 'settings') && $settings) {
      mounted.push(['settings', mountSettingsPath(ctx, cliHub, views, log, $settings)] as const);
    }
    if (!mounted.find(([k]) => k === 'clientPages') && $clientPages) {
      mounted.push(['clientPages', mountClientPagesPath(ctx, cliHub, views, log, $clientPages)] as const);
    }
    // HTTP: official DSH webServer first (kind/path/handler protocol), fallback to http/router
    if (!mounted.find(([k]) => k === 'http')) {
      const curWs = $webServer ?? safeGet(ctx, 'webServer');
      const curHttp = $http ?? safeGet(ctx, 'http');
      const curRouter = $router ?? safeGet(ctx, 'router');
      if (curWs || curHttp || curRouter) {
        const ok = mountHttpPath(ctx, cliHub, views, log, curHttp, curRouter, curWs);
        mounted.push(['http', ok] as const);
        if (ok) log.info?.(`[cli-hub:web] HTTP mounted via ${curWs ? 'webServer' : curHttp ? 'http' : curRouter ? 'router' : 'none'}`);
      }
    }
  };
  // Try once immediately
  doMount();

  // Deferred mounting: DSH's webServer / settings may activate later than this plugin (because our inject=[] activates immediately).
  // Probe every 150ms; mount the corresponding path when a new service appears, for up to 20s.
  {
    const MAX_POLL_MS = 20000;
    const INTERVAL_MS = 150;
    const started = Date.now();
    const tick = () => {
      const now = Date.now();
      // Refresh the webServer cache
      if (!$webServer) $webServer = safeGet(ctx, 'webServer');
      const freshSettings = $settings ?? safeGet(ctx, 'settings');
      const freshPages = $clientPages ?? safeGet(ctx, 'clientPages');
      const needed: string[] = [];
      if (!mounted.find(([k]) => k === 'settings') && freshSettings) needed.push('settings');
      if (!mounted.find(([k]) => k === 'clientPages') && freshPages) needed.push('clientPages');
      if (!mounted.find(([k]) => k === 'http') && ($webServer || safeGet(ctx, 'http') || safeGet(ctx, 'router'))) needed.push('http');
      if (needed.length) doMount();
      const allDone = ['settings','clientPages','http'].every((k) => mounted.find(([kk]) => kk === k) ||
        (k === 'settings' && !freshSettings) ||
        (k === 'clientPages' && !freshPages) ||
        (k === 'http' && !$webServer && !safeGet(ctx, 'http') && !safeGet(ctx, 'router') && (now - started) > MAX_POLL_MS));
      // Log on timeout (even if http wasn't mounted)
      if (!mounted.find(([k]) => k === 'http') && ((now - started) >= MAX_POLL_MS || allDone)) {
        log.warn?.(`[cli-hub:web] HTTP not mounted after ${now - started}ms; hasWebServer=${typeof $webServer} hasHttp=${typeof safeGet(ctx, 'http')} hasRouter=${typeof safeGet(ctx, 'router')}`);
      }
      if ((now - started) < MAX_POLL_MS && !mounted.find(([k]) => k === 'http')) {
        setTimeout(tick, INTERVAL_MS);
      }
    };
    setTimeout(tick, INTERVAL_MS);
  }

  // Expose the in-memory ui API (guarantees a programmatic entry even when settings/clientPages/http are all absent; unit tests rely on it too)
  const ui = createMemoryUiApi(cliHub, views, ctx, progressRing);
  cliHub.ui = ui;
  if (typeof $set === 'function') { try { $set('cliHub.ui', ui); } catch {} }

  const okList = () => mounted.filter(([, v]) => v).map(([k]) => k).join('+') || 'memory-only';
  log.info?.(`initial mount via ${okList()}; memory ui API always attached; polling http settings clientPages up to 20s.`);
}

// Same reason as the main plugin: attach inject onto the apply function object, compatible with reading factory.inject after loader unwrap
// Note: do not attach apply.Config (otherwise Cordis resolveConfig will try Standard Schema.validate and crash)
(apply as any).inject = inject;
Object.defineProperty(apply, 'displayName', { value: name, writable: false, configurable: true });

export default apply;
