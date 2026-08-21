/**
 * RegistryService —— Adapter 注册、查询、启停
 *
 * 纯内存对象，不含副作用（存储由外层驱动）。
 * 线程安全：单线程设计，Cordis Context 本身保证同步。
 */
import type { Context } from 'cordis';
import type { CliAdapterDefinition, CapabilityMode } from './types';
import { EventEmitter } from 'node:events';

export interface RegistryService {
  /** 注册一个 adapter（内置 adapter 启动时调用；第三方运行时安装）*/
  register(def: CliAdapterDefinition): void;
  /** 卸载 adapter（很少用，热更新）*/
  unregister(adapterId: string): void;
  /** 查单个 */
  get(adapterId: string): CliAdapterDefinition | undefined;
  /** 是否存在 */
  has(adapterId: string): boolean;
  /** 总数 */
  readonly size: number;
  /** 列表查询 */
  listAdapters(filter?: {
    onlyEnabled?: boolean;
    mode?: CapabilityMode;
    keyword?: string;
  }): CliAdapterDefinition[];

  /** 启用 / 禁用 */
  isEnabled(adapterId: string): boolean;
  setEnabled(adapterId: string, enabled: boolean): void;

  /** 事件（会转发到 ctx.emit）*/
  on(event: 'adapter-registered', cb: (def: CliAdapterDefinition) => void): this;
  on(event: 'adapter-unregistered', cb: (adapterId: string) => void): this;
  on(event: 'adapter-enabled-changed', cb: (adapterId: string, enabled: boolean) => void): this;
}

interface RegistryServiceInternal {
  _byId: Map<string, { def: CliAdapterDefinition; enabled: boolean }>;
  _emitter: EventEmitter;
}

export class RegistryServiceImpl implements RegistryService, RegistryServiceInternal {
  _byId = new Map<string, { def: CliAdapterDefinition; enabled: boolean }>();
  _emitter = new EventEmitter();

  constructor(
    private _ctx: Context,
    private _opts: { enabledOverrides: Record<string, boolean> },
  ) {}

  register(def: CliAdapterDefinition): void {
    this._assertValidAdapter(def);
    const forced = this._opts.enabledOverrides[def.id];
    const enabled = forced !== undefined ? forced : def.defaultEnabled !== false;
    this._byId.set(def.id, { def, enabled });
    this._emitter.emit('adapter-registered', def);
  }

  unregister(adapterId: string): void {
    if (this._byId.delete(adapterId)) this._emitter.emit('adapter-unregistered', adapterId);
  }

  get(adapterId: string): CliAdapterDefinition | undefined {
    return this._byId.get(adapterId)?.def;
  }

  has(adapterId: string): boolean {
    return this._byId.has(adapterId);
  }

  get size(): number {
    return this._byId.size;
  }

  listAdapters(filter: {
    onlyEnabled?: boolean;
    mode?: CapabilityMode;
    keyword?: string;
  } = {}): CliAdapterDefinition[] {
    const keyword = filter.keyword?.trim().toLowerCase();
    const results: CliAdapterDefinition[] = [];
    for (const entry of this._byId.values()) {
      if (filter.onlyEnabled && !entry.enabled) continue;
      if (filter.mode === 'tool' && !entry.def.capabilities.tools?.length) continue;
      if (filter.mode === 'agent' && !entry.def.capabilities.agent) continue;
      if (keyword) {
        const hay = `${entry.def.name} ${entry.def.id} ${entry.def.vendor ?? ''} ${entry.def.description}`.toLowerCase();
        if (!hay.includes(keyword)) continue;
      }
      results.push(entry.def);
    }
    return results;
  }

  isEnabled(adapterId: string): boolean {
    return this._byId.get(adapterId)?.enabled === true;
  }

  setEnabled(adapterId: string, enabled: boolean): void {
    const entry = this._byId.get(adapterId);
    if (!entry) return;
    const prev = entry.enabled;
    entry.enabled = enabled;
    if (prev !== enabled) {
      this._emitter.emit('adapter-enabled-changed', adapterId, enabled);
    }
  }

  // EventEmitter 转发
  on(event: string, cb: (...args: any[]) => void): this {
    this._emitter.on(event, cb);
    return this;
  }

  // ======= 校验器 =======
  private _assertValidAdapter(def: CliAdapterDefinition): void {
    const errs: string[] = [];
    if (!def.id || !/^[a-z0-9-]{2,64}$/.test(def.id))
      errs.push(`id 非法（需要 kebab-case 2-64 字符）: ${def.id}`);
    if (!def.name || def.name.length > 64) errs.push('name 缺失或过长');
    if (!def.description || def.description.length > 500) errs.push('description 缺失或过长');
    if (!def.fingerprint?.commandNames?.length) errs.push('fingerprint.commandNames 为空');
    const caps = def.capabilities;
    if (!caps.tools?.length && !caps.agent) errs.push('capabilities 需要至少 tools 或 agent 一项');
    if (caps.tools) {
      const names = new Set<string>();
      for (const t of caps.tools) {
        if (!t.dshToolName || !/^[\w-:]{2,80}$/.test(t.dshToolName))
          errs.push(`tool name 非法: ${t.dshToolName}`);
        if (names.has(t.dshToolName)) errs.push(`tool name 重复: ${t.dshToolName}`);
        names.add(t.dshToolName);
        if (!t.inputSchema || t.inputSchema.type !== 'object')
          errs.push(`tool ${t.dshToolName} inputSchema 需要 object`);
        if (!t.commandMapping) errs.push(`tool ${t.dshToolName} 缺少 commandMapping`);
      }
    }
    if (errs.length) throw new TypeError(`[cli-hub] adapter "${def.id}" invalid:\n  - ${errs.join('\n  - ')}`);
  }
}

export function createDefaultRegistry(
  ctx: Context,
  opts: { enabledOverrides: Record<string, boolean> },
): RegistryService {
  return new RegistryServiceImpl(ctx, opts);
}
