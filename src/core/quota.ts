/**
 * QuotaManagerService — quota management
 *
 *   · Provider queries (command / http / file / unknown)
 *   · Local cache (TTL = max(quota.refreshIntervalSec, config.cacheTtlSec))
 *   · Local estimated usage accumulation (used when the provider cannot be queried in real time)
 *   · Threshold alerts (quota-warning / quota-depleted events)
 */
import { EventEmitter } from 'node:events';
import type { Context } from 'cordis';
import type { QuotaInfo, QuotaDeclaration } from './types';
import type { RegistryService } from './registry';
import { CliHubStorage } from './storage';
import { safeGetCtx } from './safe-get';

export interface QuotaManagerConfig {
  cacheTtlSec: number;
  defaultWarningThresholdPercent: number;
}

export interface QuotaManagerService {
  get(adapterId: string, forceRefresh?: boolean): Promise<QuotaInfo>;
  subscribe(adapterId: string, cb: (info: QuotaInfo) => void): () => void;

  // Record estimated quota after a successful Tool/Agent call
  recordUsage(adapterId: string, capability: string, creditsEstimated: number): Promise<void>;

  // Thresholds
  setWarningThreshold(adapterId: string, percentRemaining: number): void;
  getWarningThreshold(adapterId: string): number;

  on(event: 'quota-changed', cb: (p: { adapterId: string; quota: QuotaInfo }) => void): this;
  on(event: 'quota-warning', cb: (p: {
    adapterId: string; remainingPercent: number; quota: QuotaInfo;
  }) => void): this;
  on(event: 'quota-depleted', cb: (p: { adapterId: string; quota: QuotaInfo }) => void): this;
}

export class QuotaManagerServiceImpl implements QuotaManagerService {
  private _emitter = new EventEmitter();
  private _subscribers = new Map<string, Set<(info: QuotaInfo) => void>>();
  private _inflight = new Map<string, Promise<QuotaInfo>>();
  private _thresholds: Record<string, number> = {};
  private _lastWarningAt: Record<string, number> = {};  // Alert throttling (10min)

  constructor(
    private _ctx: Context,
    private _registry: RegistryService,
    private _storage: CliHubStorage,
    private _config: QuotaManagerConfig,
  ) {}

  async get(adapterId: string, forceRefresh = false): Promise<QuotaInfo> {
    const def = this._registry.get(adapterId);
    if (!def) throw new Error(`adapter not found: ${adapterId}`);

    // 1. Cache hit (unless forceRefresh)
    if (!forceRefresh) {
      const cache = await this._storage.loadQuotaCache();
      const entry = cache[adapterId];
      if (entry) {
        const ttl = (def.quota?.refreshIntervalSec ?? this._config.cacheTtlSec) * 1000;
        if (Date.now() - entry.scannedAt < ttl) return entry.quota;
      }
    }

    // 2. Deduplicate concurrent queries
    const existing = this._inflight.get(adapterId);
    if (existing) return existing;

    const p = this._fetchQuota(adapterId, def.quota)
      .then(async quota => {
        await this._storage.saveQuotaCacheEntry(adapterId, quota);
        this._emitter.emit('quota-changed', { adapterId, quota });
        this._subscribers.get(adapterId)?.forEach(cb => {
          try { cb(quota); } catch { /* ignore subscriber error */ }
        });
        this._maybeEmitWarning(adapterId, quota);
        return quota;
      })
      .finally(() => this._inflight.delete(adapterId));
    this._inflight.set(adapterId, p);
    return p;
  }

  subscribe(adapterId: string, cb: (info: QuotaInfo) => void): () => void {
    if (!this._subscribers.has(adapterId)) this._subscribers.set(adapterId, new Set());
    this._subscribers.get(adapterId)!.add(cb);
    // Immediately push the cached value once (non-blocking)
    this.get(adapterId).then(cb).catch(() => {});
    return () => this._subscribers.get(adapterId)?.delete(cb);
  }

  async recordUsage(adapterId: string, capability: string, creditsEstimated: number): Promise<void> {
    if (creditsEstimated <= 0) return;
    await this._storage.recordEstimatedUsage(adapterId, capability, creditsEstimated);
    // If the adapter cannot query quota precisely (unknown), synthesize quota from local estimates and emit events
    const def = this._registry.get(adapterId);
    if (def?.quota?.method.kind === 'unknown') {
      const usage = await this._storage.getEstimatedUsage();
      const bucket = usage[adapterId] ?? {};
      let totalCredits = 0;
      let totalCalls = 0;
      for (const v of Object.values(bucket)) {
        totalCredits += v.credits;
        totalCalls += v.calls;
      }
      const synthetic: QuotaInfo = {
        source: 'estimate',
        currency: 'credits',
        used: totalCredits,
        refreshedAt: Date.now(),
        period: 'onetime',
        breakdown: Object.entries(bucket).map(([c, v]) => ({ capability: c, used: v.credits })),
      };
      this._emitter.emit('quota-changed', { adapterId, quota: synthetic });
    }
  }

  setWarningThreshold(adapterId: string, percentRemaining: number): void {
    if (percentRemaining < 1 || percentRemaining > 99) throw new RangeError('threshold must be 1..99');
    this._thresholds[adapterId] = percentRemaining;
  }

  getWarningThreshold(adapterId: string): number {
    return this._thresholds[adapterId] ?? this._config.defaultWarningThresholdPercent;
  }

  on(event: string, cb: (...args: any[]) => void): this {
    this._emitter.on(event, cb);
    return this;
  }

  // ============== Internal ==============
  private async _fetchQuota(adapterId: string, declaration: QuotaDeclaration | undefined): Promise<QuotaInfo> {
    if (!declaration) return this._makeEstimateOnly(adapterId);
    const m = declaration.method;
    switch (m.kind) {
      case 'command':
        try {
          const parts = m.cmd.split(/\s+/);
          const cmd = parts.shift()!;
          const { stdout, exitCode } = await (this._exec(cmd, parts));
          if (exitCode === 0) return m.parser(stdout);
          return this._makeEstimateOnly(adapterId, `command exit ${exitCode}`);
        } catch (e: any) {
          return this._makeEstimateOnly(adapterId, e.message ?? String(e));
        }
      case 'http': {
        try {
          let headers: Record<string, string> = { ...(m.headers ?? {}) };
          if (m.authHeader) {
            const val = typeof m.authHeader === 'function' ? await m.authHeader() : m.authHeader;
            headers['Authorization'] = val;
          }
          const resp = await fetch(m.url, { headers });
          const data = await resp.json();
          return m.parser(data);
        } catch (e: any) {
          return this._makeEstimateOnly(adapterId, e.message ?? String(e));
        }
      }
      case 'file': {
        const fs = await import('node:fs');
        const os = await import('node:os');
        try {
          const p = m.path.replace(/^~/, os.homedir());
          const content = fs.readFileSync(p, 'utf8');
          return m.parser(content);
        } catch (e: any) {
          return this._makeEstimateOnly(adapterId, e.message ?? String(e));
        }
      }
      case 'unknown':
      default:
        return this._makeEstimateOnly(adapterId);
    }
  }

  private async _makeEstimateOnly(adapterId: string, errorHint?: string): Promise<QuotaInfo> {
    const usage = await this._storage.getEstimatedUsage();
    const bucket = usage[adapterId] ?? {};
    let credits = 0;
    for (const v of Object.values(bucket)) credits += v.credits;
    return {
      source: 'estimate',
      currency: 'credits',
      used: credits,
      refreshedAt: Date.now(),
      period: 'onetime',
      breakdown: Object.entries(bucket).map(([c, v]) => ({ capability: c, used: v.credits })),
      raw: errorHint ? { errorHint } : undefined,
    };
  }

  private async _exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    let sp: any = undefined;
    try { sp = safeGetCtx(this._ctx, 'subprocess'); } catch {}
    if (sp && typeof sp.exec === 'function') {
      try {
        const r = await sp.exec(cmd, args, { timeout: 10_000, rejectOnNonZeroExit: false });
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? null };
      } catch (e: any) { /* Fall back to native */ }
    }
    return import('node:child_process').then(({ spawn }) => new Promise(resolve => {
      let stdout = '', stderr = '', done = false;
      const t = setTimeout(() => {
        if (done) return; done = true;
        try { c.kill('SIGKILL'); } catch {}
        resolve({ stdout, stderr, exitCode: null });
      }, 10_000);
      let c: any;
      try { c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e: any) {
        clearTimeout(t);
        resolve({ stdout: '', stderr: String(e?.message ?? e), exitCode: null });
        return;
      }
      c.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      c.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      c.on('error', (e: any) => { if (done) return; done = true; clearTimeout(t); resolve({ stdout, stderr: String(e?.message ?? e), exitCode: null }); });
      c.on('close', (code: any) => { if (done) return; done = true; clearTimeout(t); resolve({ stdout, stderr, exitCode: code }); });
    }));
  }

  private _maybeEmitWarning(adapterId: string, quota: QuotaInfo): void {
    if (quota.total === undefined || quota.total <= 0) return;
    const remaining = Math.max(0, (quota.remaining ?? (quota.total - quota.used)) / quota.total * 100);
    const thr = this.getWarningThreshold(adapterId);
    const now = Date.now();
    const lastWarn = this._lastWarningAt[adapterId] ?? 0;
    if (remaining <= 0) {
      if (now - lastWarn > 60_000) {       // depleted at most once per 1 minute
        this._lastWarningAt[adapterId] = now;
        this._emitter.emit('quota-depleted', { adapterId, quota });
      }
    } else if (remaining <= thr) {
      if (now - lastWarn > 10 * 60_000) {  // warning at most once per 10 minutes
        this._lastWarningAt[adapterId] = now;
        this._emitter.emit('quota-warning', { adapterId, remainingPercent: remaining, quota });
      }
    }
  }
}

export function createDefaultQuotaManager(
  ctx: Context,
  registry: RegistryService,
  storage: CliHubStorage,
  partialConfig: Partial<QuotaManagerConfig>,
): QuotaManagerService {
  const cfg: QuotaManagerConfig = { cacheTtlSec: 300, defaultWarningThresholdPercent: 10, ...partialConfig };
  return new QuotaManagerServiceImpl(ctx, registry, storage, cfg);
}
