/**
 * Cordis main entry (loosely-coupled types variant)
 *
 * On "why not directly extend cordis.Service + Schema config":
 *   DSH is currently in fast rc iteration; cordis 4.0.0-rc.8's type exports are inconsistent (Schema/TypedEvent/Fragment are not in the root namespace).
 *   To avoid tight coupling between the plugin layer and DSH's internal version breaking compilation, we adopt:
 *     · Config as a pure TS type + manual defaults (no Schema auto-validation)
 *     · ctx.emit with explicit string names + (thisArg as any) to bypass cordis Events extends recursion
 *     · ctx.set('cliHub', ...) with duck-typing, no Service base class required
 *   Runtime semantics are fully equivalent; once DSH officially ships 1.0 we can switch back to strong typing in one go.
 */
import type { Context, Effect, Events as CordEvents } from 'cordis';
import { createDefaultScanner } from './core/scanner';
import { createDefaultRegistry } from './core/registry';
import { createDefaultQuotaManager } from './core/quota';
import { createToolGateway } from './core/gateway-tool';
import { createAgentGateway } from './core/gateway-agent';
import { loadBuiltinAdapters } from './adapters/builtin';
import * as cliPlugin from './cli/index';
import * as webPlugin from './web/index';
import type {
  CliHubService,
  ScanResult,
  ScanDepth,
  CliAdapterDefinition,
  ScanItem,
  QuotaInfo,
  CapabilityMode,
} from './core/types';
import { CliHubStorage, ScopedStorageLike } from './core/storage';

// === Re-exports (consumers import from 'dsh-plugin-cli-hub') ===
export { defineCliAdapter } from './adapters/define';
export { loadBuiltinAdapters, BUILTIN_ADAPTERS } from './adapters/builtin';
// For tests / debug scripts only: construct AgentGateway / ToolGateway instances directly without full Cordis startup
export { createAgentGateway, AgentGatewayImpl } from './core/gateway-agent';
export type { AgentSession, AgentGateway, AgentSessionStatus } from './core/gateway-agent';
export { createToolGateway } from './core/gateway-tool';
// Sub-plugin exports for external manual mounting (e2e / calling after custom injection of settings/http)
export const webSubPlugin = webPlugin;
export const cliSubPlugin = cliPlugin;
export type {
  CliAdapterDefinition,
  ToolCapabilityDeclaration,
  AgentCapabilityDeclaration,
  QuotaDeclaration,
  CliFingerprint,
  ScanItem,
  ScanResult,
  QuotaInfo,
  RuntimeContext,
  ScanDepth,
  AuthState,
  CapabilityMode,
  CliHubService,
} from './core/types';

export const name = 'dsh-plugin-cli-hub';
/**
 * inject design decision (v3, aligned with DSH 0.1.1-rc.1):
 *
 *  Cordis v4 ctx proxy trap rules (see cordis/lib/index.js L671-695):
 *    · If fiber.runtime exists (i.e. loaded by the loader), then when reading `ctx.<name>`,
 *      if `<name>` is not in the `fiber.inject` array → it throws `cannot get property "X" without inject` directly.
 *    · Only when fiber.runtime is empty (root fiber) does the `reflect.get(name, false)` bypass apply.
 *
 *  This means the previous `inject = []` let the fiber activate immediately while all
 *  service accesses like `ctx.webServer` were rejected by the proxy trap. `safeGet`'s
 *  `reflect.get(name, false)` fallback only works on the root fiber; in child fibers
 *  loaded by the DSH loader it still returns undefined.
 *
 *  Fix: explicitly add the cordis services we need to access into inject. webServer is a
 *  mandatory service for the DSH web profile (provided by @deepseek-ai/dsh-host-webserver);
 *  after adding it to inject:
 *    · the fiber activates only after the webServer service is ready (avoids activating too early and missing it)
 *    · `ctx.webServer` is directly accessible, so HTTP routes can be mounted
 *  Other services (storage/settings/tools/logger/subprocess) keep using the safeGet
 *  fallback, because they may not exist in test environments or non-web profiles;
 *  force-injecting them would deadlock.
 */
export const inject: string[] = [];

/** Safely read a property on the Cordis ctx: try/catch on every path.
 *  - With inject=['webServer'], ctx.webServer is directly readable; other services may still throw and need a fallback.
 *  - safeGet's reflect.get(name, false) fallback only takes effect on the root fiber;
 *    in child fibers loaded by the loader, non-injected service names throw
 *    `cannot get property "X" without inject`, caught by try/catch and returning undefined.
 */
function safeGet(ctx: any, name: string): any {
  if (!ctx) return undefined;
  // Path 0: if raw/internal exists (the proxy backend exposed by some DSH versions), read it directly to skip the trap
  var raw: any = undefined;
  try {
    if ((ctx as any).internal !== undefined) raw = (ctx as any).internal;
    else if ((ctx as any).raw !== undefined) raw = (ctx as any).raw;
    else if ((ctx as any).root !== undefined) raw = (ctx as any).root;
  } catch {}
  try {
    if (raw && raw !== null && typeof raw === 'object') {
      if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];
    }
  } catch {}
  try {
    var svc: any = (ctx as any).service;
    if (svc && svc !== null && typeof svc === 'object') {
      if (Object.prototype.hasOwnProperty.call(svc, name)) return svc[name];
    }
  } catch {}
  // Path 0.5: some DSH/cordis versions use the Context.get(name, required?) pattern
  try {
    var ctxAny = (ctx as any);
    if (ctxAny !== null && typeof ctxAny.get === 'function') {
      var vGet = ctxAny.get(name, false);
      if (vGet !== undefined) return vGet;
    }
  } catch {}
  // Path 1: official Cordis reflect.get bypass
  try {
    var reflect: any = (ctx as any).reflect;
    if (reflect !== null && reflect !== undefined && typeof reflect.get === 'function') {
      var vRefl = reflect.get(name, false);
      if (vRefl !== undefined) return vRefl;
    }
  } catch {}
  // Path 1.5: services map of ctx.runtime / ctx.fiber.runtime
  try {
    var rts: any = undefined;
    var ctxAny2 = (ctx as any);
    if (ctxAny2.runtime !== null && ctxAny2.runtime !== undefined) rts = ctxAny2.runtime;
    else {
      var fiber = ctxAny2.fiber;
      if (fiber !== null && fiber !== undefined && fiber.runtime !== undefined) rts = fiber.runtime;
    }
    if (rts !== null && rts !== undefined && typeof rts === 'object') {
      var map: any = undefined;
      if (rts.services !== undefined) map = rts.services;
      else if (rts._services !== undefined) map = rts._services;
      if (map !== null && map !== undefined && typeof map === 'object') {
        if (Object.prototype.hasOwnProperty.call(map, name)) {
          var entry = map[name];
          if (entry !== null && entry !== undefined && typeof entry === 'object' && entry.value !== undefined) return entry.value;
          if (entry !== undefined) return entry;
        }
      }
    }
  } catch {}
  // Path 2: fallback plain read (headless non-cordis environments)
  try { var v2 = ctx[name]; if (v2 !== undefined) return v2; } catch {}
  return undefined;
}

export interface Config {
  scan?: {
    defaultDepth?: ScanDepth;
    autoRefreshIntervalSec?: number;
    timeoutPerCmd?: number;
    showUnknown?: boolean;
  };
  quota?: {
    cacheTtlSec?: number;
    defaultWarningThresholdPercent?: number;
  };
  gateway?: {
    failureCooldownCount?: number;
    failureCooldownSec?: number;
    sandboxLevel?: 'strict' | 'relaxed';
  };
  adapters?: {
    enabledOverrides?: Record<string, boolean>;
  };
}

export function apply(ctx: Context, config: Config = {}) {
  const anyCtx = ctx as any;
  // ============== All native ctx services uniformly go through safeGet (bypasses inject allowlist checks + fiber pending) ==============
  const $logger  = safeGet(ctx, 'logger');
  const $storage = safeGet(ctx, 'storage');
  const $set     = safeGet(ctx, 'set');
  const $emit    = safeGet(ctx, 'emit');
  const $parallel= safeGet(ctx, 'parallel');
  const $on      = safeGet(ctx, 'on');
  const $lifecycle = safeGet(ctx, 'lifecycle');
  const $plugin  = safeGet(ctx, 'plugin');

  const logger = (typeof $logger === 'function' ? $logger('dsh-plugin-cli-hub') : undefined) ?? {
    debug: (...a: any[]) => process.env.DSH_VERBOSE && console.debug('[cli-hub]', ...a),
    info: (...a: any[]) => console.info('[cli-hub]', ...a),
    warn: (...a: any[]) => console.warn('[cli-hub]', ...a),
    error: (...a: any[]) => console.error('[cli-hub]', ...a),
  };

  // ====== Apply default config ======
  const scanCfg = {
    defaultDepth: config.scan?.defaultDepth ?? 'l3' as ScanDepth,
    autoRefreshIntervalSec: config.scan?.autoRefreshIntervalSec ?? 1800,
    timeoutPerCmd: config.scan?.timeoutPerCmd ?? 3000,
    showUnknown: config.scan?.showUnknown ?? true,
  };
  const quotaCfg = {
    cacheTtlSec: config.quota?.cacheTtlSec ?? 300,
    defaultWarningThresholdPercent: config.quota?.defaultWarningThresholdPercent ?? 10,
  };
  const gwCfg = {
    failureCooldownCount: config.gateway?.failureCooldownCount ?? 5,
    failureCooldownSec: config.gateway?.failureCooldownSec ?? 30,
    sandboxLevel: config.gateway?.sandboxLevel ?? 'strict' as const,
  };
  const enabledOverrides = config.adapters?.enabledOverrides ?? {};

  // --- 1. Storage (prefer ctx.storage.scoped; fall back to an in-memory version if unavailable) ---
  let scopedStorage: ScopedStorageLike;
  if ($storage && typeof $storage === 'object' && typeof ($storage as any).scoped === 'object') {
    scopedStorage = ($storage as any).scoped;
  } else {
    const mem: Record<string, any> = {};
    scopedStorage = {
      async get(k) { return mem[k]; },
      async set(k, v) { mem[k] = v; },
    };
  }
  const storage = new CliHubStorage(scopedStorage);

  // --- 2. Registry ---
  const registry = createDefaultRegistry(ctx, { enabledOverrides });
  loadBuiltinAdapters(registry);

  // --- 3. Scanner ---
  const scanner = createDefaultScanner(ctx, registry, scanCfg);

  // --- 4. Quota ---
  const quota = createDefaultQuotaManager(ctx, registry, storage, quotaCfg);

  // --- 5. Tool Gateway ---
  const toolGateway = createToolGateway(ctx, registry, quota, storage, gwCfg);

  // --- 5b. Agent Gateway ---
  const cfgAny = config as any;
  const agentGateway = createAgentGateway(ctx, registry, {
    defaultReadyTimeoutMs: typeof cfgAny.agent?.defaultReadyTimeoutMs === 'number' ? cfgAny.agent.defaultReadyTimeoutMs : undefined,
    defaultShutdownGraceMs: typeof cfgAny.agent?.defaultShutdownGraceMs === 'number' ? cfgAny.agent.defaultShutdownGraceMs : undefined,
    singletonPerAdapter: cfgAny.agent?.singletonPerAdapter ?? true,
    sandboxLevel: gwCfg.sandboxLevel === 'strict' ? 'strict' : 'default',
  });

  // --- 6. Aggregate cliHub API ---
  const cliHub: CliHubService = {
    registry: registry as any,
    scanner: scanner as any,
    quota: quota as any,
    tools: toolGateway as any,
    agents: agentGateway as any,

    async scan(
      optsOrDepth: ScanDepth | { depth?: ScanDepth; timeoutPerCmd?: number; adapterIds?: string[] } = scanCfg.defaultDepth,
    ): Promise<ScanResult> {
      const opts = typeof optsOrDepth === 'string' ? { depth: optsOrDepth } : (optsOrDepth ?? {});
      const depth: ScanDepth = (opts as any).depth ?? scanCfg.defaultDepth;
      const items: ScanItem[] = await (scanner as any).scan(opts);
      const enabledCount = items.filter(i => i.adapterId && registry.isEnabled(i.adapterId)).length;
      const authenticated = items.filter(i => i.authState === 'authenticated').length;
      const result: ScanResult = {
        scannedAt: Date.now(),
        depth,
        items,
        summary: {
          total: items.length,
          matched: items.filter(i => i.adapterId).length,
          enabled: enabledCount,
          authenticated,
          quotaWarning: 0,
        },
      };
      await storage.saveLastScan(items);
      // Publish to the shared view cache so web/CLI projections see fresh data instantly
      // (views prefer _scanCache over storage reads).
      (cliHub as any)._scanCache = result;
      // Async: refresh tool registrations for enabled adapters
      queueMicrotask(() => {
        (toolGateway as any).syncRegistrations(items.filter(i => i.adapterId)).catch((e: any) =>
          logger.warn('syncRegistrations error:', e?.message ?? e),
        );
      });
      return result;
    },

    list(filter: { onlyEnabled?: boolean; mode?: CapabilityMode } = {}): CliAdapterDefinition[] {
      return (registry as any).listAdapters
        ? (registry as any).listAdapters(filter)
        : (registry as any).list(filter);
    },

    enable(adapterId: string) {
      registry.setEnabled(adapterId, true);
      storage.persistAdapterEnabled(adapterId, true).catch(() => {});
      emit('cli-hub/cli-enabled', { adapterId });
    },

    disable(adapterId: string) {
      registry.setEnabled(adapterId, false);
      storage.persistAdapterEnabled(adapterId, false).catch(() => {});
      (toolGateway as any).unregisterForAdapter?.(adapterId);
      // On disable, also kill any running agent session to avoid continued quota consumption
      agentGateway.stop(adapterId).catch((e: any) => logger.warn?.('stop agent session failed:', e?.message ?? e));
      emit('cli-hub/cli-disabled', { adapterId });
    },
  };

  // Mount onto ctx (compatible with DSH's ctx.set, ctx.reflect.provide, and as the reflect store's getter)
  try {
    // Method 1: DSH ctx.set (if available)
    if (typeof $set === 'function') {
      try { $set('cliHub', cliHub); } catch {}
    }
    // Method 2: native Cordis reflect.provide (mounted onto the current fiber store, accessible to sub-plugins)
    const reflect = safeGet(ctx, 'reflect');
    if (reflect && typeof reflect.provide === 'function') {
      try { reflect.provide('cliHub', cliHub, () => true); } catch {}
    }
    // Method 3: if the parent fiber's runtime does not exist (headless minimal environment), try direct assignment
    try {
      const fiber = (ctx as any).fiber;
      if (!fiber?.runtime) { (ctx as any).cliHub = cliHub; }
    } catch {}
  } catch { /* ignore all */ }

  // --- 7. Event relaying (use $emit/$parallel instead of anyCtx.xxx to avoid inject allowlist interception) ---
  function emit(name: string, payload: any) {
    try {
      if (typeof $emit === 'function') $emit(name, payload);
      else if (typeof $parallel === 'function') $parallel(name, payload);
    } catch (e) {
      logger.debug(`emit ${name} failed:`, e);
    }
  }
  for (const [evt, relayed] of [
    ['cli-detected', 'cli-hub/cli-detected'] as const,
    ['scan-progress', 'cli-hub/scan-progress'] as const,
  ]) {
    try { (scanner as any).on?.(evt, (p: any) => emit(relayed, p)); } catch {}
  }
  for (const [evt, relayed] of [
    ['quota-warning', 'cli-hub/quota-warning'] as const,
    ['quota-changed', 'cli-hub/quota-changed'] as const,
    ['quota-depleted', 'cli-hub/quota-depleted'] as const,
  ]) {
    try { (quota as any).on?.(evt, (p: any) => emit(relayed, p)); } catch {}
  }
  for (const [evt, relayed] of [
    ['tool-called', 'cli-hub/tool-called'] as const,
    ['tool-succeeded', 'cli-hub/tool-succeeded'] as const,
    ['tool-failed', 'cli-hub/tool-failed'] as const,
  ]) {
    try { (toolGateway as any).on?.(evt, (p: any) => emit(relayed, p)); } catch {}
  }
  // Agent event relaying
  for (const [evt, relayed] of [
    ['agent-spawned', 'cli-hub/agent-spawned'] as const,
    ['agent-ready', 'cli-hub/agent-ready'] as const,
    ['agent-shutdown', 'cli-hub/agent-shutdown'] as const,
    ['agent-error', 'cli-hub/agent-error'] as const,
  ]) {
    try { (agentGateway as any).on?.(evt, (p: any) => emit(relayed, p)); } catch {}
  }

  // --- 9. dispose hook: kill all agents when DSH shuts down to avoid orphan processes ---
  const doDispose = async () => {
    try { await agentGateway.stopAll(); }
    catch (e: any) { logger.warn?.('agent stopAll failed:', e?.message ?? e); }
  };
  if (typeof $on === 'function') {
    try {
      $on('dispose', doDispose);
    } catch {
      // In some Cordis rc versions dispose is not an event name; fall back to process exit
      (process as any).once?.('beforeExit', doDispose);
    }
  } else {
    (process as any).once?.('beforeExit', doDispose);
  }

  // --- 8. ready side effects: load persisted state + first L1 scan + background refresh ---
  const onReady = async () => {
    logger.debug?.('plugin ready. adapter count=', (registry as any).size);
    const persisted = await storage.loadAdapterEnabledStates();
    for (const [id, enabled] of Object.entries(persisted)) registry.setEnabled(id, enabled);
    try {
      // The first scan goes through cliHub.scan (triggers syncRegistrations → ctx.tools registration)
      const first = await (cliHub as any).scan({ depth: 'l1' });
      logger.info?.('initial L1 scan done. items=', first?.items?.length ?? first?.length ?? 0);
    } catch (err: any) {
      logger.warn?.('initial scan error:', err?.message ?? err);
    }
    if (scanCfg.autoRefreshIntervalSec > 0) {
      const intervalMs = Math.min(scanCfg.autoRefreshIntervalSec, 86400) * 1000;
      const timer: any = setInterval(async () => {
        try { await (cliHub as any).scan({ depth: 'l3' }); }
        catch (err: any) { logger.warn?.('background refresh scan failed:', err?.message ?? err); }
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
  };
  // DSH/Cordis ready hook
  // Reliability: some profile shapes never emit 'ready' (or emit before we register),
  // which silently skipped the initial scan + persisted-state restore. Guard with a
  // once-flag and add a delayed fallback so startup side effects always run exactly once.
  let readyHandled = false;
  const onReadyOnce = async () => {
    if (readyHandled) return;
    readyHandled = true;
    await onReady();
  };
  if (typeof $on === 'function') {
    try {
      $on('ready', onReadyOnce);
      const fallback = setTimeout(() => { void onReadyOnce(); }, 3000);
      if (typeof fallback.unref === 'function') fallback.unref();
    } catch { $lifecycle?.onReady?.(onReadyOnce) ?? queueMicrotask(onReadyOnce); }
  } else {
    queueMicrotask(onReadyOnce);
  }

  logger.info?.('loaded.');

  // --- Mount sub-plugins: CLI commands + Web UI ---
  // Reliability notes (3rd refactor; previously writing _cliHub onto the module ns/apply function via tagApply still failed):
  //   · Cordis DSH's $plugin(factory, cfg) re-unwraps the factory into a plugin object and enters a new fiber,
  //     causing apply._cliHub to be lost in the new fiber. So prefer calling `apply(ctx, subCfg)` directly,
  //     using "explicit argument passing + closure visibility" within the same function scope to guarantee 100% access to cliHub.
  //   · factory.apply(ctx, subCfg) is not fn.call — what is actually called here is ns.apply (the named export apply function)
  //     and ns.default (the default export referencing the same function). Calling both covers all cases.
  const subCfg: any = { _cliHub: cliHub };

  // Also copy cliHub to three positions on subCfg (some rc versions wrap config in an extra cfg.config layer)
  subCfg.config = subCfg.config ?? { _cliHub: cliHub };
  (subCfg.config as any)._cliHub = cliHub;

  const mountSubPluginDirect = (ns: any, label: string, applyFnName: 'apply' | 'default') => {
    // Prefer a direct call (no new fiber, no inject resolution); fall back to $plugin on failure
    const fn = (ns as any)?.[applyFnName];
    if (typeof fn !== 'function') return false;
    try {
      // Explicitly pass cliHub as a third "hidden argument" so it can still be read from arguments[2] if any cfg wrapping is lost
      fn.call(null, ctx, subCfg, cliHub);
      return true;
    } catch (e: any) {
      logger?.warn?.(`[cli-hub] mount sub-plugin ${label} (${applyFnName}) direct call failed: ${e?.message ?? e}`);
      return false;
    }
  };

  // Retry in order: "direct call → $plugin → module root function (if it is itself a function)"
  const mountSubPlugin = (factory: any, label: string) => {
    if (!factory) return;
    let ok = false;
    ok = mountSubPluginDirect(factory, label, 'default') || ok;
    ok = mountSubPluginDirect(factory, label, 'apply') || ok;
    if (!ok && typeof factory === 'function') {
      try {
        factory(ctx, subCfg, cliHub);
        ok = true;
      } catch (e: any) {
        logger?.warn?.(`[cli-hub] mount sub-plugin ${label} (factory) failed: ${e?.message ?? e}`);
      }
    }
    if (!ok && typeof $plugin === 'function') {
      try { $plugin(factory, subCfg); } catch (e: any) {
        logger?.warn?.(`[cli-hub] mount sub-plugin ${label} ($plugin) failed: ${e?.message ?? e}`);
      }
    }
  };
  mountSubPlugin(cliPlugin, 'cli');
  mountSubPlugin(webPlugin, 'web');
}

// ============================================================
// Attach inject onto the apply function object itself (coexists with the `export const inject` named export).
// Reason: DSH/Cordis's cordis-plugin-loader unwrapExports takes the module default,
// then goes through `registry.plugin(plugin, config)`, which internally does `Inject.resolve(plugin.inject)`.
// If inject only exists as a named export (not attached to the default=apply function object), then
// plugin.inject = undefined and Inject.resolve returns an empty map — seemingly fine; but
// when the get trap in `Context.reflect` reads ctx.fiber.runtime as non-null, it intercepts
// reads like ctx.storage with "inject allowlist required" semantics → throws "cannot get
// property storage without inject". The dual write does not affect callers (named export
// for unit tests/external scripts; apply.inject for loader identification).
//
// Notes:
//   · inject is an empty array → the fiber can activate at any time (we have duck-typing
//     fallbacks for all ctx properties and do not require a service to be provided; see comments above).
//   · We deliberately do not attach Config. Cordis `resolveConfig` runs
//     Standard Schema.validate when runtime.Config is not undefined, but our Config is a
//     pure TS interface (no ~standard field); carelessly attaching it as {} would cause
//     "Cannot read properties of undefined reading validate".
// ============================================================
(apply as any).inject = inject;

export default apply;

// ============================================================
// Type declarations: let the DSH/Cordis context be aware of ctx.cliHub + custom events
// (uses declare module, without strongly binding the Events recursive extension)
// ============================================================
declare module 'cordis' {
  interface Context {
    cliHub?: CliHubService;
  }
}
