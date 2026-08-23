/**
 * RegistryService — adapter registration, lookup, enable/disable
 *
 * Pure in-memory object with no side effects (storage is driven by the outer layer).
 * Thread safety: single-threaded design; Cordis Context itself guarantees synchronization.
 */
import type { Context } from 'cordis';
import type { CliAdapterDefinition, CapabilityMode } from './types';
import { EventEmitter } from 'node:events';

export interface RegistryService {
  /** Register an adapter (built-in adapters are registered at startup; third parties at runtime) */
  register(def: CliAdapterDefinition): void;
  /** Unregister an adapter (rarely used, hot updates) */
  unregister(adapterId: string): void;
  /** Look up one */
  get(adapterId: string): CliAdapterDefinition | undefined;
  /** Whether it exists */
  has(adapterId: string): boolean;
  /** Total count */
  readonly size: number;
  /** List query */
  listAdapters(filter?: {
    onlyEnabled?: boolean;
    mode?: CapabilityMode;
    keyword?: string;
  }): CliAdapterDefinition[];

  /** Enable / disable */
  isEnabled(adapterId: string): boolean;
  setEnabled(adapterId: string, enabled: boolean): void;

  /** Events (forwarded to ctx.emit) */
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

  // EventEmitter forwarding
  on(event: string, cb: (...args: any[]) => void): this {
    this._emitter.on(event, cb);
    return this;
  }

  // ======= Validators =======
  private _assertValidAdapter(def: CliAdapterDefinition): void {
    const errs: string[] = [];
    if (!def.id || !/^[a-z0-9-]{2,64}$/.test(def.id))
      errs.push(`id is invalid (kebab-case of 2-64 chars required): ${def.id}`);
    if (!def.name || def.name.length > 64) errs.push('name is missing or too long');
    if (!def.description || def.description.length > 500) errs.push('description is missing or too long');
    if (!def.fingerprint?.commandNames?.length) errs.push('fingerprint.commandNames is empty');
    const caps = def.capabilities;
    if (!caps.tools?.length && !caps.agent) errs.push('capabilities requires at least one of tools or agent');
    if (caps.tools) {
      const names = new Set<string>();
      for (const t of caps.tools) {
        if (!t.dshToolName || !/^[\w-:]{2,80}$/.test(t.dshToolName))
          errs.push(`tool name is invalid: ${t.dshToolName}`);
        if (names.has(t.dshToolName)) errs.push(`duplicate tool name: ${t.dshToolName}`);
        names.add(t.dshToolName);
        if (!t.inputSchema || t.inputSchema.type !== 'object')
          errs.push(`tool ${t.dshToolName} inputSchema must be an object`);
        if (!t.commandMapping) errs.push(`tool ${t.dshToolName} is missing commandMapping`);
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
