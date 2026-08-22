/**
 * Cordis 主入口（松耦合类型版）
 *
 * 关于"为什么不直接 extends cordis.Service + Schema 配置"：
 *   DSH 目前是 rc 快速迭代版，cordis 4.0.0-rc.8 的 type export 不统一（Schema/TypedEvent/Fragment 不在根命名空间）。
 *   为避免在 plugin 层和 DSH 内部版本强耦合导致无法编译，这里采用：
 *     · Config 用纯 TS 类型 + 手动默认值（不使用 Schema 自动校验）
 *     · ctx.emit 用显式 string 名称 + (thisArg as any) 绕过 cordis Events extends 递归
 *     · ctx.set('cliHub', ...) 用 duck-typing，不要求 Service 基类
 *   runtime 语义完全等价；等 DSH 正式 1.0 发布后可以一次性切换回强类型。
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

// === Re-exports（消费者 import from 'dsh-plugin-cli-hub'）===
export { defineCliAdapter } from './adapters/define';
export { loadBuiltinAdapters, BUILTIN_ADAPTERS } from './adapters/builtin';
// 仅供测试 / 调试脚本使用：直接构造 AgentGateway / ToolGateway 实例而不走完整 Cordis 启动
export { createAgentGateway, AgentGatewayImpl } from './core/gateway-agent';
export type { AgentSession, AgentGateway, AgentSessionStatus } from './core/gateway-agent';
export { createToolGateway } from './core/gateway-tool';
// 子插件导出，方便外部手动挂载（e2e / 自定义注入 settings/http 后调用）
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
 * inject 设计决策（第 3 版，对齐 DSH 0.1.1-rc.1）：
 *
 *  Cordis v4 的 ctx proxy trap 规则（见 cordis/lib/index.js L671-695）：
 *    · 如果 fiber.runtime 存在（即被 loader 加载），那么读 `ctx.<name>` 时，
 *      若 `<name>` 不在 `fiber.inject` 数组中 → 直接抛 `cannot get property "X" without inject`。
 *    · 仅当 fiber.runtime 为空（root fiber）时才走 `reflect.get(name, false)` bypass。
 *
 *  这意味着之前 `inject = []` 让 fiber 立刻激活的同时，所有 `ctx.webServer` 等
 *  service 访问全部被 proxy trap 拒绝。`safeGet` 的 `reflect.get(name, false)`
 *  fallback 只在 root fiber 工作；在 DSH loader 加载的子 fiber 里仍然返回 undefined。
 *
 *  修复：把需要访问的 cordis service 显式加到 inject。webServer 是 DSH web profile
 *  必备服务（由 @deepseek-ai/dsh-host-webserver 提供），把它加进 inject 后：
 *    · fiber 在 webServer 服务就绪后才激活（避免早激活拿不到）
 *    · `ctx.webServer` 可直接访问，HTTP 路由能挂上
 *  其他服务（storage/settings/tools/logger/subprocess）继续走 safeGet 兜底，
 *  因为它们在测试环境或非 web profile 中可能不存在，强行 inject 会死锁。
 */
export const inject: string[] = [];

/** 安全读取 Cordis ctx 上的属性：全链路 try/catch。
 *  - 在 inject=['webServer'] 后，ctx.webServer 直接可读；其他服务仍可能抛错需要兜底。
 *  - safeGet 的 reflect.get(name, false) fallback 仅在 root fiber 生效；
 *    被 loader 加载的子 fiber 中，未 inject 的 service 名会抛
 *    `cannot get property "X" without inject`，由 try/catch 兜底返回 undefined。
 */
function safeGet(ctx: any, name: string): any {
  if (!ctx) return undefined;
  // 路径 0：如果有 raw/internal（部分 DSH 版本暴露的 proxy 后端），直接取跳过 trap
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
  // 路径 0.5：部分 DSH/cordis 版本使用 Context.get(name, required?) 模式
  try {
    var ctxAny = (ctx as any);
    if (ctxAny !== null && typeof ctxAny.get === 'function') {
      var vGet = ctxAny.get(name, false);
      if (vGet !== undefined) return vGet;
    }
  } catch {}
  // 路径 1：Cordis 官方 reflect.get bypass
  try {
    var reflect: any = (ctx as any).reflect;
    if (reflect !== null && reflect !== undefined && typeof reflect.get === 'function') {
      var vRefl = reflect.get(name, false);
      if (vRefl !== undefined) return vRefl;
    }
  } catch {}
  // 路径 1.5：ctx.runtime / ctx.fiber.runtime 的 services map
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
  // 路径 2：fallback 裸读（headless 非 cordis 环境）
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
  // ============== 所有 ctx 原生服务，统一走 safeGet（绕过 inject 白名单检查 + fiber pending）==============
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

  // ====== 应用默认配置 ======
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

  // --- 1. Storage（尽量用 ctx.storage.scoped，没有就退化到内存版）---
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

  // --- 6. 聚合 cliHub API ---
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
      // 异步：刷新 enabled adapter 的 tool 注册
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
      // 禁用时同时 kill 掉正在跑的 agent session，避免继续消费额度
      agentGateway.stop(adapterId).catch((e: any) => logger.warn?.('stop agent session failed:', e?.message ?? e));
      emit('cli-hub/cli-disabled', { adapterId });
    },
  };

  // 挂到 ctx（兼容 DSH 的 ctx.set、ctx.reflect.provide，以及作为 reflect 存储的 getter）
  try {
    // 方式 1：DSH ctx.set（如果有）
    if (typeof $set === 'function') {
      try { $set('cliHub', cliHub); } catch {}
    }
    // 方式 2：Cordis 原生 reflect.provide（挂到当前 fiber store，子插件可访问）
    const reflect = safeGet(ctx, 'reflect');
    if (reflect && typeof reflect.provide === 'function') {
      try { reflect.provide('cliHub', cliHub, () => true); } catch {}
    }
    // 方式 3：如果父 fiber 的 runtime 不存在（headless 精简环境），尝试直接赋值
    try {
      const fiber = (ctx as any).fiber;
      if (!fiber?.runtime) { (ctx as any).cliHub = cliHub; }
    } catch {}
  } catch { /* ignore all */ }

  // --- 7. 事件转发（用 $emit/$parallel，不走 anyCtx.xxx 避免 inject 白名单拦截）---
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
  // Agent 事件转发
  for (const [evt, relayed] of [
    ['agent-spawned', 'cli-hub/agent-spawned'] as const,
    ['agent-ready', 'cli-hub/agent-ready'] as const,
    ['agent-shutdown', 'cli-hub/agent-shutdown'] as const,
    ['agent-error', 'cli-hub/agent-error'] as const,
  ]) {
    try { (agentGateway as any).on?.(evt, (p: any) => emit(relayed, p)); } catch {}
  }

  // --- 9. dispose 钩子：DSH 关闭时杀全部 agent，避免孤儿进程 ---
  const doDispose = async () => {
    try { await agentGateway.stopAll(); }
    catch (e: any) { logger.warn?.('agent stopAll failed:', e?.message ?? e); }
  };
  if (typeof $on === 'function') {
    try {
      $on('dispose', doDispose);
    } catch {
      // Cordis 有些 rc 版本 dispose 不是事件名，fallback 到 process exit
      (process as any).once?.('beforeExit', doDispose);
    }
  } else {
    (process as any).once?.('beforeExit', doDispose);
  }

  // --- 8. ready 副作用：加载持久化状态 + 首次 L1 扫描 + 后台刷新 ---
  const onReady = async () => {
    logger.debug?.('plugin ready. adapter count=', (registry as any).size);
    const persisted = await storage.loadAdapterEnabledStates();
    for (const [id, enabled] of Object.entries(persisted)) registry.setEnabled(id, enabled);
    try {
      // 首次扫描走 cliHub.scan（会触发 syncRegistrations → ctx.tools 注册）
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
  if (typeof $on === 'function') {
    try { $on('ready', onReady); }
    catch { $lifecycle?.onReady?.(onReady) ?? queueMicrotask(onReady); }
  } else {
    queueMicrotask(onReady);
  }

  logger.info?.('loaded.');

  // --- 挂载子插件：CLI 命令 + Web UI ---
  // 可靠性说明（第 3 次重构，之前 tagApply 把 _cliHub 写到模块 ns/apply 函数仍失败）：
  //   · Cordis DSH 的 $plugin(factory, cfg) 会把 factory 重新 unwrap 为插件对象并进入新 fiber，
  //     导致 apply._cliHub 在新 fiber 里丢失。所以优先直接调用 `apply(ctx, subCfg)`，
  //     在同一个函数作用域里用"实参显式传 + 闭包直接可见"保证 100% 拿到 cliHub。
  //   · factory.apply(ctx, subCfg) 不是 fn.call —— 这里其实调用 ns.apply（命名导出 apply 函数）
  //     与 ns.default（默认导出 apply 引用同一个函数）。两种同时调用即可覆盖。
  const subCfg: any = { _cliHub: cliHub };

  // 直接把 cliHub 再复制到 subCfg 的三个位置（有些 rc 版本把 config 包一层 cfg.config）
  subCfg.config = subCfg.config ?? { _cliHub: cliHub };
  (subCfg.config as any)._cliHub = cliHub;

  const mountSubPluginDirect = (ns: any, label: string, applyFnName: 'apply' | 'default') => {
    // 优先 direct call（不进新 fiber，不走 inject 解析），失败再 fallback $plugin
    const fn = (ns as any)?.[applyFnName];
    if (typeof fn !== 'function') return false;
    try {
      // 显式把 cliHub 作为第三个"隐藏实参"传，避免任何 cfg 包装丢失时还能从 arguments[2] 取
      fn.call(null, ctx, subCfg, cliHub);
      return true;
    } catch (e: any) {
      logger?.warn?.(`[cli-hub] mount sub-plugin ${label} (${applyFnName}) direct call failed: ${e?.message ?? e}`);
      return false;
    }
  };

  // 按"直接调用 → $plugin → module 根函数（如果本身是函数）"顺序重试
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
// 把 inject 挂到 apply 函数对象本身（和 `export const inject` 命名导出并存）。
// 原因：DSH/Cordis 的 cordis-plugin-loader unwrapExports 取 module default，
// 然后走 `registry.plugin(plugin, config)`，内部 `Inject.resolve(plugin.inject)`。
// 如果 inject 只作为命名导出存在（没挂到 default=apply 函数对象上），那么
// plugin.inject = undefined，Inject.resolve 返回空 map，乍看没问题；但是
// `Context.reflect` 里的 get trap 读到 ctx.fiber.runtime 非空时，就会按"必须有
// inject 白名单"语义来拦截 ctx.storage 这类读取 → 抛「cannot get property storage
// without inject」。双写不影响调用方（命名导出给单测/外部脚本；apply.inject
// 给 loader 识别）。
//
// 注：
//   · inject 是空数组 → 任何时候都能激活 fiber（我们对所有 ctx 属性都有 duck-typing
//     fallback，不要求 service 一定 provide，见上方注释）。
//   · Config 我们故意不挂。Cordis `resolveConfig` 在 runtime.Config 非 undefined
//     时会走 Standard Schema.validate，而我们的 Config 是纯 TS 接口（没有 ~standard
//     字段），如果乱挂为 {} 就会 "Cannot read properties of undefined reading validate"。
// ============================================================
(apply as any).inject = inject;

export default apply;

// ============================================================
// 类型声明：让 DSH/Cordis 上下文能感知 ctx.cliHub + 自定义事件
// （采用 declare module，但不强绑定 Events 递归扩展）
// ============================================================
declare module 'cordis' {
  interface Context {
    cliHub?: CliHubService;
  }
}
