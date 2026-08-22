/**
 * dsh-plugin-cli-hub Web UI 面板
 *
 * 三条兼容路径（至少一条必生效，顺序 1 → 2 → 3 兜底）：
 *
 *   1) ctx.settings.registerSection — DSH 设置页卡片式结构
 *   2) ctx.clientPages.register   — DSH 独立路由页（/cli-hub），server-driven 组件树
 *   3) ctx.http / ctx.router REST JSON endpoints — 任何外部前端都可 fetch；
 *      再不行还会挂 ctx.cliHub.ui 内存 API（供 CLI/其他插件代码直接调）。
 *
 * 能力：
 *   · Scanner 数据展示（最后一次扫描 + 手动重新扫描 + 进度）
 *   · Adapter 启用/禁用开关（真实回写 registry + storage + agent stop + tool unregister）
 *   · Agent 会话表 + 停止按钮
 *   · Dashboard 汇总（总数/已匹配/已启用/已认证/会话数）
 *
 * 不引入前端构建依赖；所有 UI 描述以 JSON 组件树返回，渲染由 DSH 负责。
 */
import type { Context } from 'cordis';
import type {
  AuthState,
  CliAdapterDefinition,
  ScanItem,
  ScanResult,
  ScanDepth,
} from '../core/types';

export const name = 'dsh-plugin-cli-hub/web';
// 与主插件相同的设计决策：所有 ctx 属性都走 safeGet，inject 为空（永远能激活）
// 这样纯 CLI 模式（dsh cli-hub list）下，插件不会因为缺 webServer 服务而永远 pending；
// HTTP 路由通过 apply 内部的延迟轮询 safeGet 拿到 webServer 后再挂载，拿不到就跳过。
export const inject: string[] = [];

/** 与主插件一致的安全属性读取：绕过 inject 白名单检查。
 *  注：Cordis rc 版即使 reflect.get(prop,false) 也会抛"cannot get property X without inject"
 *  ——必须全链路 try/catch，尽可能从 raw/internal 直接取。
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
// UI 数据投影（纯函数，零运行时依赖/零副作用）
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
  installed: boolean;          // registry 存在（永远 true，保留作未来扩展）
  discovered: boolean;         // 上次 scan 是否实际发现本机有这个 CLI
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
  authenticated: '已登录',
  unauthenticated: '未登录',
  expired: '凭证过期',
  unknown: '未知',
};

function authBadge(s: AuthState) {
  return { label: AUTH_LABELS[s], color: AUTH_COLORS[s] };
}

// 把 capability flags 折叠成标签数组
function capsOf(def: CliAdapterDefinition | undefined): Array<'tool' | 'agent'> {
  if (!def) return [];
  const out: Array<'tool' | 'agent'> = [];
  if (def.capabilities.tools?.length) out.push('tool');
  if (def.capabilities.agent) out.push('agent');
  return out;
}

// registry + lastScan → 两个表结构（Scanner 发现 表 / Adapter 清单 表）
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
        label: enabled ? '禁用' : '启用',
        variant: enabled ? 'danger' : 'primary',
        payload: { adapterId: i.adapterId, enabled: !enabled },
      });
    }
    if (i.authState === 'unauthenticated' && def?.installHint) {
      actions.push({ id: 'show-install-hint', label: '登录指引', variant: 'info', payload: { adapterId: def.id } });
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
        label: enabled ? '禁用' : '启用',
        variant: enabled ? 'danger' : 'primary',
        payload: { adapterId: def.id, enabled: !enabled },
      },
    ];
    if (def.installHint && !scan) {
      actions.push({ id: 'show-install-hint', label: '安装指引', variant: 'info', payload: { adapterId: def.id } });
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
      { id: 'agent-send', label: '发消息', variant: 'default', payload: { adapterId: s.adapterId, sessionId: s.sessionId } },
      { id: 'agent-stop', label: '停止', variant: 'danger', payload: { adapterId: s.adapterId } },
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
    // 只展示已发现且已认证的 adapter 的 tool（避免列出 CLI 没装的工具）
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
// 动作派发（任何路径最终都调这里：settings action / component tree / HTTP POST / memory API）
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
      // 同步更新 web 缓存，让 dashboard / adapterRows 立即拿到最新扫描结果
      // 通过 cliHub._scanCache 共享（避免 web apply 被多次调用时不同 views 实例闭包不共享）
      try { cliHub.ui?.setCachedResult?.(result); } catch {}
      try { (cliHub as any)._scanCache = result; } catch {}
      return { ok: true, message: `scan(${depth}) 完成, matched=${result?.summary?.matched ?? 0}/${result?.summary?.total ?? 0}`, data: result?.summary };
    }
    case 'toggle-adapter': {
      const id: string | undefined = payload?.adapterId;
      const enabled = !!payload?.enabled;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
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
      return { ok: true, message: `启用了 ${count} 个已登录 adapter` };
    }
    case 'disable-all': {
      for (const a of cliHub.list({ onlyEnabled: true })) cliHub.disable(a.id);
      return { ok: true };
    }
    case 'agent-spawn': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
      if (!cliHub.agents?.spawn) return { ok: false, message: '当前 cliHub.agents 不支持 spawn' };
      try {
        const session = await cliHub.agents.spawn(id, payload?.options);
        return { ok: true, message: `agent 已启动: ${session?.sessionId ?? id}`, data: session };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'agent-stop': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
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
      if (!id) return { ok: false, message: 'adapterId 缺失' };
      if (message == null) return { ok: false, message: 'message 缺失' };
      try {
        // 优先用 cliHub.agents.getSession(adapterId) 拿到完整 AgentSession（含 send 方法）
        // listSessions 返回的是简化投影对象（无 send 方法），不能直接用
        const session = cliHub.agents?.getSession?.(id);
        if (session && typeof session.send === 'function') {
          await session.send(message);
          return { ok: true, message: `消息已发送到 session ${session.sessionId}` };
        }
        // fallback：尝试用 sessionId 在 listSessions 中匹配再尝试 send
        if (sessionId) {
          const listed = (cliHub.agents?.listSessions?.() ?? []).find((s: any) => s.sessionId === sessionId);
          if (listed && typeof (listed as any).send === 'function') {
            await (listed as any).send(message);
            return { ok: true, message: `消息已发送到 session ${listed.sessionId}` };
          }
        }
        // 最终 fallback：直接调 cliHub.agents.send(adapterId, msg) 如果存在
        if (typeof cliHub.agents?.send === 'function') {
          await cliHub.agents.send(id, message);
          return { ok: true };
        }
        return { ok: false, message: '没有可用的 session.send 或 cliHub.agents.send 方法' };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'quota-refresh': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
      if (!cliHub.quota?.refresh) return { ok: false, message: '当前 cliHub.quota 不支持 refresh' };
      try {
        const q = await cliHub.quota.refresh(id);
        return { ok: true, message: `额度刷新完成: ${id}`, data: q };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'quota-refresh-all': {
      if (!cliHub.quota?.refreshAll) {
        // 退化：对每个已启用的 adapter 分别 refresh
        const ids = (cliHub.list?.({ onlyEnabled: true }) ?? []).map((a: any) => a.id);
        const results: any[] = [];
        for (const id of ids) {
          try { if (cliHub.quota?.refresh) results.push(await cliHub.quota.refresh(id)); }
          catch (e: any) { results.push({ adapterId: id, error: String(e?.message ?? e) }); }
        }
        return { ok: true, message: `刷新 ${results.length} 个 adapter 额度`, data: results };
      }
      try {
        const results = await cliHub.quota.refreshAll();
        return { ok: true, message: '全部额度刷新完成', data: results };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'tool-exec': {
      const toolName: string | undefined = payload?.toolName;
      const input: any = payload?.input ?? {};
      if (!toolName) return { ok: false, message: 'toolName 缺失' };
      if (!cliHub.tools?.execute) return { ok: false, message: '当前 cliHub.tools 不支持 execute' };
      try {
        const result = await cliHub.tools.execute(toolName, input);
        return { ok: true, message: `tool ${toolName} 执行完成`, data: result };
      } catch (e: any) { return { ok: false, message: String(e?.message ?? e) }; }
    }
    case 'show-install-hint': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
      const def = cliHub.registry?.get?.(id);
      if (!def?.installHint) return { ok: false, message: '无安装指引' };
      return { ok: true, message: def.installHint, data: { installHint: def.installHint, officialDoc: def.officialDoc } };
    }
    case 'adapter-detail': {
      const id: string | undefined = payload?.adapterId;
      if (!id) return { ok: false, message: 'adapterId 缺失' };
      const def = cliHub.registry?.get?.(id);
      if (!def) return { ok: false, message: `未找到 adapter: ${id}` };
      const scanItems = (await getLastScan(cliHub)) ?? [];
      const scan = scanItems.find((s: any) => s.adapterId === id) ?? null;
      let quota: any = null;
      try { if (cliHub.quota?.get) quota = await cliHub.quota.get(id); } catch {}
      const detail = projectAdapterDetail(def, {
        registryEnabled: (rid: string) => cliHub.registry?.isEnabled?.(rid) ?? false,
        scan,
        quota,
      });
      return { ok: true, message: `adapter 详情: ${id}`, data: detail };
    }
    default:
      return { ok: false, message: `未知动作: ${actionId}` };
  }
}

async function getLastScan(cliHub: any): Promise<ScanItem[] | null> {
  try {
    // 先尝试 storage.loadLastScan（内存快路径），没的话用 cliHub.scan cached
    const last = await (cliHub as any).scanner?._lastScan
      ?? (await (cliHub as any).storage?.loadLastScan?.())
      ?? null;
    if (last && Array.isArray(last.items)) return last.items;
    if (last && Array.isArray(last)) return last;
  } catch {}
  return null;
}

// ============================================================
// 视图函数（供 settings/clientPages/HTTP 共用）
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
  // 把缓存挂到 cliHub 上，避免 web apply 被多次调用时不同 views 实例的闭包不共享
  if (!(cliHub as any)._scanCache) (cliHub as any)._scanCache = null;
  const getLastScanOrCached: UiViews['getLastScanOrCached'] = async () => {
    // 优先读 cliHub._scanCache（跨 views 实例共享），fallback 到本闭包的 lastCachedResult
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
      // 多种 API 形态兼容：cliHub.quota.get(id) / cliHub.quota.snapshot(id) / cache 查询
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
// Settings 路径 A
// ============================================================
function mountSettingsPath(ctx: Context, cliHub: any, views: UiViews, log: any, settings?: any): boolean {
  // 参数优先（来自 safeGet），兜底也通过 safeGet 读一次（保持单测时 headless 环境的 ctx.settings 直读仍可用）
  const $settings = settings ?? (() => { try { return safeGet(ctx, 'settings'); } catch { return undefined; } })();
  if (!$settings || typeof $settings.registerSection !== 'function') return false;
  try {
    $settings.registerSection({
      id: 'cli-hub',
      title: 'CLI Hub',
      icon: 'terminal',
      // settings 协议如果支持 onAction 回调就直接走派发
      onAction:
        $settings._supportsOnAction !== false
          ? async (actionId: string, payload: any) => dispatchUiAction(ctx, cliHub, actionId, payload)
          : undefined,
      render: () => ({
        sections: [
          // --- Dashboard 摘要 ---
          {
            title: '概览',
            description: '本机 AI CLI 接入与额度消耗统计',
            headerActions: [
              { id: 'scan', label: '快速扫描(L1)', variant: 'default', payload: { depth: 'l1' } },
              { id: 'quota-refresh-all', label: '刷新全部额度', variant: 'primary' },
            ],
            refresh: async () => views.getDashboard(),
          },
          // --- Scanner 发现 ---
          {
            title: '已发现的 AI CLI',
            description: 'L3 扫描会调用各 CLI 的 auth status 校验登录态（网络请求，~数秒）。',
            headerActions: [
              { id: 'scan', label: '重新扫描(L3)', variant: 'primary', payload: { depth: 'l3' } },
              { id: 'scan', label: '快速扫描(L1)', variant: 'default', payload: { depth: 'l1' } },
            ],
            columns: [
              { key: 'displayName', label: '名称' },
              { key: 'version', label: '版本' },
              { key: 'authBadge', label: '登录' },
              { key: 'capabilities', label: '能力' },
              { key: 'enabled', label: '启用' },
              { key: 'executablePath', label: '安装路径' },
            ],
            refresh: async (payload: any) => {
              const depth: ScanDepth = (payload?.depth as ScanDepth) ?? 'l3';
              const timeoutPerCmd: number | undefined = payload?.timeoutPerCmd;
              return views.getScannerRows(depth, timeoutPerCmd);
            },
          },
          // --- Adapter 清单（含未安装） ---
          {
            title: 'Adapter 开关（全部内置）',
            description: '禁用会同步停止正在跑的 Agent 子进程并从 DSH 工具表注销该 CLI 的工具。点"详情"展开 adapter 完整信息。',
            headerActions: [
              { id: 'enable-all-authed', label: '启用全部已登录', variant: 'primary' },
              { id: 'disable-all', label: '禁用全部', variant: 'danger' },
            ],
            columns: [
              { key: 'name', label: '适配器' },
              { key: 'discovered', label: '已安装' },
              { key: 'version', label: '探测版本' },
              { key: 'authBadge', label: '登录' },
              { key: 'capabilities', label: '能力' },
              { key: 'enabled', label: '启用' },
            ],
            refresh: async () => views.getAdapterRows(),
          },
          // --- 额度监控 ---
          {
            title: '额度监控',
            description: '每个已启用 adapter 的额度使用情况。点"刷新"重新拉取（会调 CLI 或 HTTP）。',
            headerActions: [
              { id: 'quota-refresh-all', label: '刷新全部额度', variant: 'primary' },
            ],
            columns: [
              { key: 'adapterName', label: '适配器' },
              { key: 'used', label: '已用' },
              { key: 'total', label: '总额度' },
              { key: 'percent', label: '使用率(%)' },
              { key: 'currency', label: '单位' },
              { key: 'refreshedAt', label: '刷新时间' },
            ],
            refresh: async () => views.getQuotaRows(),
          },
          // --- 工具清单（已发现 + 已认证的 CLI 工具）---
          {
            title: '可用工具',
            description: '已发现且已认证的 CLI 暴露给 DSH agent 的工具清单。点"执行"测试工具调用。',
            columns: [
              { key: 'toolName', label: '工具名' },
              { key: 'adapterName', label: '来源' },
              { key: 'description', label: '说明' },
              { key: 'estimatedCredits', label: '预估额度' },
              { key: 'enabled', label: '启用' },
            ],
            refresh: async () => views.getToolRows(),
          },
          // --- Agent 会话 ---
          {
            title: 'Agent 会话',
            description: '长连接子 Agent 进程；点"停止"走优雅关机（SIGINT → grace → SIGKILL）。',
            headerActions: [{ id: 'agent-stop-all', label: '停止全部', variant: 'danger' }],
            columns: [
              { key: 'adapterName', label: '适配器' },
              { key: 'pid', label: 'PID' },
              { key: 'status', label: '状态' },
              { key: 'durationMs', label: '运行时长(ms)' },
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
// ClientPages 路径 B
// ============================================================
function mountClientPagesPath(ctx: Context, cliHub: any, views: UiViews, log: any, clientPages?: any): boolean {
  const $clientPages = clientPages ?? (() => { try { return safeGet(ctx, 'clientPages'); } catch { return undefined; } })();
  if (!$clientPages || typeof $clientPages.register !== 'function') return false;
  try {
    // DSH 真实协议未知；我们采用"server-driven 组件树"描述，并挂 action dispatcher
    // 如果 DSH runtime 不接受 componentTree 字段，回落到 placeholder 但 panel.meta 提供 HTTP API 入口
    const panel = {
      kind: 'component-tree',
      meta: {
        description: 'CLI Hub Dashboard + Scanner 表 + Adapter 开关 + 额度监控 + 工具清单 + Agent 会话',
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
              { id: 'scan', label: '重新扫描', variant: 'primary', payload: { depth: 'l3' } },
              { id: 'quota-refresh-all', label: '刷新全部额度', variant: 'default' },
            ] },
            { type: 'table', title: '已发现 CLI', columns: rows.length ? Object.keys(rows[0]).filter(k => k !== 'actions') : [], rows, rowActions: 'actions' },
            { type: 'table', title: 'Adapter 开关', columns: adapters.length ? Object.keys(adapters[0]).filter(k => k !== 'actions') : [], rows: adapters, rowActions: 'actions', expandable: { actionId: 'adapter-detail', keyField: 'id' } },
            { type: 'table', title: '额度监控', columns: quota.length ? Object.keys(quota[0]) : [], rows: quota, rowActions: [{ id: 'quota-refresh', label: '刷新', variant: 'default', payloadKey: 'adapterId' }] },
            { type: 'table', title: '可用工具', columns: tools.length ? Object.keys(tools[0]).filter(k => k !== 'inputSchema') : [], rows: tools, rowActions: [{ id: 'tool-exec', label: '执行', variant: 'primary', payloadKey: 'toolName' }] },
            { type: 'table', title: 'Agent 会话', columns: sessions.length ? Object.keys(sessions[0]).filter(k => k !== 'actions') : [], rows: sessions, rowActions: 'actions' },
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
// HTTP 降级路径 C（ctx.webServer / ctx.http / ctx.router）
// DSH 官方使用 `@deepseek-ai/dsh-host-webserver` 的 `webServer` service，
// 协议是：webServer.register({ kind: "exact" | "prefix", path, method?, handler(req,res) })。
// 如果没拿到 webServer（测试/旧版本 DSH），再回退到 ctx.http / ctx.router 风格。
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

  // 方法路由包装：如果 route 没声明 method，需要在 handler 内过滤
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

  // ------- 方式 1：DSH webServer.register（优先） -------
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
      reg('prefix', 'GET', '/plugins/cli-hub/api/dashboard', async (req, res) => send(res, 200, await views.getDashboard())),
      reg('prefix', 'GET', '/cli-hub/api/dashboard', async (req, res) => send(res, 200, await views.getDashboard())),
      // adapters list + detail 合并为单个 prefix 路由（避免 duplicate path 抛错）：
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

  // ------- 方式 2：$http.get / $router.get 等（如果 DSH 用其他 server 插件） -------
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
    log?.debug?.('registered partial HTTP API (部分前缀)');
    return true;
  }
  return false;
}

/** 通用 JSON 响应发送：兼容 Express/Koa/原生 http 响应风格。 */
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

/** 从 node:http IncomingMessage 里解析 query string（webServer 协议不走 Koa query）。 */
function parseQueryFromUrl(rawUrl: string): Record<string, string> {
  try {
    const u = new URL(rawUrl, 'http://x');
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch { return {}; }
}

/** 从 url 中提取 /adapters/<id> 的 id 部分（兼容 ? 后的 query）。 */
function extractAdapterIdFromUrl(rawUrl: string, marker: string): string | null {
  try {
    const pathOnly = rawUrl.split('?')[0];
    const idx = pathOnly.indexOf(marker);
    if (idx < 0) return null;
    const after = pathOnly.slice(idx + marker.length);
    // after 形如 "<id>" 或 "<id>/quota"
    const segments = after.split('/').filter(Boolean);
    return segments[0] ?? null;
  } catch { return null; }
}

/** 从 IncomingMessage 读取 JSON body（DSH webServer 不自动 body parse）。 */
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
 * SSE 长连接：把 cliHub 的 progress ring + cliHub.on 事件流式推送给前端。
 * 协议：Content-Type: text/event-stream，每条消息 `data: <json>\n\n`。
 * 保持连接 5 分钟自动断开（前端可重连），期间 cliHub.emit 的事件会被
 * subscribeEvents 推入 progressRing，由本函数 drain 推送。
 */
async function handleSse(req: any, res: any, cliHub: any, log: any) {
  // 只支持原生 IncomingMessage 风格（res.writeHead + res.write）
  if (!res || typeof res.writeHead !== 'function' || typeof res.write !== 'function') {
    // Koa 风格降级：返回一次性 drain 的 JSON（非流）
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

    // 借助 cliHub.ui 内存 API 的 drainEvents 作为事件源；如果没有则降级到心跳
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
    // 5 分钟超时自动断开（前端可重连）
    const maxAgeTimer: any = setTimeout(() => {
      try { res.write(`data: ${JSON.stringify({ type: 'close', reason: 'max-age' })}\n\n`); } catch {}
      try { clearInterval(drainTimer); } catch {}
      try { res.end(); } catch {}
    }, 5 * 60 * 1000);

    // 客户端断开清理
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
// 事件订阅 + 内存 API 兜底
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
  // UI action 总线（settings 协议没有 onAction 时，前端可以 emit 这个事件触发动作）
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
    /** 同步更新 views 的 scan 缓存（scan action 调用后让 dashboard 立即拿到最新结果） */
    setCachedResult: (r: ScanResult | null) => views.setCachedResult?.(r),
    /** 事件 ring buffer：自上次 drain 之后的所有事件（ui 轮询） */
    drainEvents: () => progressRing.drain(),
  };
}

// 简易 ring buffer（最多 50 条，drain 一次清空）
function makeRing(size = 50) {
  const buf: any[] = [];
  return {
    push(e: any) { buf.push(e); if (buf.length > size) buf.shift(); },
    drain() { const out = buf.slice(); buf.length = 0; return out; },
  };
}

// ============================================================
// apply 入口
// ============================================================
export function apply(ctx: Context, cfg: any = undefined, _cliHub3rd: any = undefined) {
  // inject=[]：fiber 立刻激活（不依赖 webServer 服务），HTTP 路由通过延迟轮询 safeGet 拿到 webServer 后再挂载。
  // 这样纯 CLI 模式（dsh cli-hub list 等）下插件不会因为缺 webServer 而 pending。
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

  // 挂载优先级（按可靠性从强到弱）：
  //   1) 主插件 mountSubPluginDirect 传的「第三实参」（不经过任何 config/对象拷贝，最稳）
  //   2) 主插件通过 tagApply 写在 apply 函数上的 _cliHub
  //   3) 主插件 mountSubPlugin config 传的 cfg._cliHub / cfg.config._cliHub
  //   4) safeGet(ctx,'cliHub')（reflect.provide effect 之后才可见，一般仅 UI 路由延迟回调）
  const from3rd   = _cliHub3rd;
  const fromApply = (apply as any)?._cliHub;
  const fromCfgA  = (cfg as any)?._cliHub;
  const fromCfgB  = (cfg as any)?.config?._cliHub;
  const fromCtx   = safeGet(ctx, 'cliHub');
  const cliHub: any = from3rd ?? fromApply ?? fromCfgA ?? fromCfgB ?? fromCtx;

  // ------ DSH ctx 诊断：收集所有 top-level key 名 + runtime services 名 ------
  let ctxKeys: string[] = [];
  let svcKeys: string[] = [];
  let runtimeServicesEntries: Record<string, string> = {};
  let safeGetProbe: Record<string, string> = {};
  try {
    // 路径 A：多种 ctx 形态下的 ownKeys
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
        // 记录本对象中 server-like 字段
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

    // 路径 B：reflect.keys（可能叫 keys/list/entries，多试几个名字）
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

    // 路径 C：用 safeGet 主动探测常见 web server 候选名（忽略大小写差异）
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
  // 通过闭包注入 $on / $addEventListener（subscribeEvents 内部之前读 anyCtx.on）
  subscribeEvents(ctx, cliHub, progressRing, log, { $on, $addEventListener });

  const mounted: Array<readonly [string, boolean]> = [];
  const doMount = () => {
    // settings / clientPages：非轮询，第一次有就装
    if (!mounted.find(([k]) => k === 'settings') && $settings) {
      mounted.push(['settings', mountSettingsPath(ctx, cliHub, views, log, $settings)] as const);
    }
    if (!mounted.find(([k]) => k === 'clientPages') && $clientPages) {
      mounted.push(['clientPages', mountClientPagesPath(ctx, cliHub, views, log, $clientPages)] as const);
    }
    // HTTP：DSh 官方 webServer 优先（kind/path/handler 协议），回退 http/router
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
  // 立即尝试一次
  doMount();

  // 延迟挂载：DSh 的 webServer / settings 可能比本插件激活得晚（因为我们 inject=[]，立即激活）。
  // 每 150ms 探测一次，发现新服务就挂对应 mount，最多 20s。
  {
    const MAX_POLL_MS = 20000;
    const INTERVAL_MS = 150;
    const started = Date.now();
    const tick = () => {
      const now = Date.now();
      // 刷新对 webServer 的缓存
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
      // 超时时打日志（哪怕 http 没装上）
      if (!mounted.find(([k]) => k === 'http') && ((now - started) >= MAX_POLL_MS || allDone)) {
        log.warn?.(`[cli-hub:web] HTTP not mounted after ${now - started}ms; hasWebServer=${typeof $webServer} hasHttp=${typeof safeGet(ctx, 'http')} hasRouter=${typeof safeGet(ctx, 'router')}`);
      }
      if ((now - started) < MAX_POLL_MS && !mounted.find(([k]) => k === 'http')) {
        setTimeout(tick, INTERVAL_MS);
      }
    };
    setTimeout(tick, INTERVAL_MS);
  }

  // 暴露内存级 ui API（保证 settings/clientPages/http 全不存在时仍有可编程入口，单测也靠它）
  const ui = createMemoryUiApi(cliHub, views, ctx, progressRing);
  cliHub.ui = ui;
  if (typeof $set === 'function') { try { $set('cliHub.ui', ui); } catch {} }

  const okList = () => mounted.filter(([, v]) => v).map(([k]) => k).join('+') || 'memory-only';
  log.info?.(`initial mount via ${okList()}; memory ui API always attached; polling http settings clientPages up to 20s.`);
}

// 与主插件同样的原因：把 inject 挂到 apply 函数对象上，兼容 loader unwrap 后读 factory.inject
// 注意：不要挂 apply.Config（否则 Cordis resolveConfig 会尝试走 Standard Schema.validate 崩）
(apply as any).inject = inject;
Object.defineProperty(apply, 'displayName', { value: name, writable: false, configurable: true });

export default apply;
