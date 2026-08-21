/**
 * 持久化层：复用 DSH ctx.storage.scoped（DSH 专有）。
 * 不在类型里强绑 Context.storage，而是构造时直接传入 scoped 接口。
 */
import type { QuotaInfo, ScanItem } from './types';

const STORAGE_KEY = 'dsh-plugin-cli-hub:v1';
const HISTORY_LIMIT = 100;

function makeDefaultData(): PersistedSchema {
  return {
    version: 1,
    adapterEnabled: {},
    quotaCache: {},
    estimatedUsage: {},
    lastScan: null,
    callHistory: [],
  };
}

export interface ScopedStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove?(key: string): Promise<void>;
}

interface PersistedSchema {
  version: 1;
  adapterEnabled: Record<string, boolean>;
  quotaCache: Record<string, { quota: QuotaInfo; scannedAt: number }>;
  estimatedUsage: Record<string, Record<string, { calls: number; credits: number }>>;
  lastScan: { ts: number; items: ScanItem[] } | null;
  callHistory: Array<{
    id: string;
    ts: number;
    adapterId: string;
    mode: 'tool' | 'agent';
    capability: string;
    success: boolean;
    durationMs: number;
    creditsUsed: number;
    error?: string;
  }>;
}

export class CliHubStorage {
  private cache: PersistedSchema | null = null;

  constructor(private storage: ScopedStorageLike) {}

  private async read(): Promise<PersistedSchema> {
    if (this.cache) return this.cache;
    try {
      const raw = await this.storage.get<PersistedSchema>(STORAGE_KEY);
      this.cache = raw && raw.version === 1 ? raw : makeDefaultData();
    } catch {
      this.cache = makeDefaultData();
    }
    return this.cache;
  }

  private async write(data: PersistedSchema): Promise<void> {
    this.cache = data;
    await this.storage.set(STORAGE_KEY, data);
  }

  async loadAdapterEnabledStates(): Promise<Record<string, boolean>> {
    return (await this.read()).adapterEnabled;
  }

  async persistAdapterEnabled(adapterId: string, enabled: boolean): Promise<void> {
    const data = await this.read();
    data.adapterEnabled = { ...data.adapterEnabled, [adapterId]: enabled };
    await this.write(data);
  }

  async loadQuotaCache() {
    return (await this.read()).quotaCache;
  }

  async saveQuotaCacheEntry(adapterId: string, quota: QuotaInfo): Promise<void> {
    const data = await this.read();
    data.quotaCache[adapterId] = { quota, scannedAt: Date.now() };
    await this.write(data);
  }

  async recordEstimatedUsage(adapterId: string, capability: string, creditsDelta: number): Promise<void> {
    const data = await this.read();
    const bucket = data.estimatedUsage[adapterId] ?? {};
    const prev = bucket[capability] ?? { calls: 0, credits: 0 };
    bucket[capability] = { calls: prev.calls + 1, credits: prev.credits + creditsDelta };
    data.estimatedUsage[adapterId] = bucket;
    await this.write(data);
  }

  async getEstimatedUsage() {
    return (await this.read()).estimatedUsage;
  }

  async saveLastScan(items: ScanItem[]): Promise<void> {
    const data = await this.read();
    data.lastScan = { ts: Date.now(), items };
    await this.write(data);
  }

  async loadLastScan(): Promise<{ ts: number; items: ScanItem[] } | null> {
    return (await this.read()).lastScan;
  }

  async pushHistory(
    entry: Omit<PersistedSchema['callHistory'][number], 'id' | 'ts'> & { id?: string; ts?: number },
  ): Promise<void> {
    const data = await this.read();
    data.callHistory.unshift({
      id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: entry.ts ?? Date.now(),
      adapterId: entry.adapterId,
      mode: entry.mode,
      capability: entry.capability,
      success: entry.success,
      durationMs: entry.durationMs,
      creditsUsed: entry.creditsUsed,
      error: entry.error,
    });
    if (data.callHistory.length > HISTORY_LIMIT) data.callHistory.length = HISTORY_LIMIT;
    await this.write(data);
  }

  async loadHistory() {
    return (await this.read()).callHistory;
  }
}
