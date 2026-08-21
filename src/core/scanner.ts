/**
 * ScannerService —— 本机 CLI 自动发现
 *
 * 三层扫描策略：
 *   L1（~20ms）：枚举 PATH 目录下的可执行文件名，与 registry 指纹做 match。
 *                 不启动任何子进程，秒出结果。
 *   L2（~200ms per match）：对 L1 命中的每个候选执行 `cmd --version`，
 *                  用 fingerprint.versionPattern 解析版本。
 *   L3（~300ms per match）：探测登录状态：
 *                  · 检查 fingerprint.envVars 是否存在
 *                  · 检查 fingerprint.configPaths 是否存在（~展开）
 *                  · 运行 fingerprint.authCheck.cmd 并匹配 stdout
 *
 * 暴露流式 API（watchScan）和 Promise API（scan）。
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Context } from 'cordis';
import type {
  ScanItem,
  ScanDepth,
  AuthState,
  CliFingerprint,
} from './types';
import type { RegistryService } from './registry';
import { safeGetCtx } from './safe-get';

export interface ScannerConfig {
  defaultDepth: ScanDepth;
  autoRefreshIntervalSec: number;
  timeoutPerCmd: number;
  showUnknown: boolean;
}

export interface ScannerService {
  scan(opts?: {
    depth?: ScanDepth;
    adapterIds?: string[];
    timeoutPerCmd?: number;
  }): Promise<ScanItem[]>;

  watchScan(opts?: { depth?: ScanDepth }): AsyncIterable<ScanItem>;

  on(event: 'cli-detected', cb: (p: { item: ScanItem; isNew: boolean }) => void): this;
  on(event: 'scan-progress', cb: (p: { done: number; total: number; latest?: ScanItem }) => void): this;
  on(event: 'scan-started', cb: (p: { depth: ScanDepth }) => void): this;
  on(event: 'scan-done', cb: (p: ScanItem[]) => void): this;
}

type PathEntry = { name: string; fullPath: string; isExecutable: boolean };

export class ScannerServiceImpl implements ScannerService {
  private _emitter = new EventEmitter();
  private _previousScan = new Map<string, ScanItem>();
  private _pathCache?: { ts: number; entries: PathEntry[] };

  constructor(
    private _ctx: Context,
    private _registry: RegistryService,
    private _config: ScannerConfig,
  ) {}

  // ================ 对外 API ================
  async scan(opts: {
    depth?: ScanDepth;
    adapterIds?: string[];
    timeoutPerCmd?: number;
  } = {}): Promise<ScanItem[]> {
    const depth = opts.depth ?? this._config.defaultDepth;
    const timeout = opts.timeoutPerCmd ?? this._config.timeoutPerCmd;
    this._emitter.emit('scan-started', { depth });

    const adapters = opts.adapterIds
      ? (opts.adapterIds.map(id => this._registry.get(id)).filter(Boolean) as any[])
      : this._registry.listAdapters();

    // 1. 构建 "文件名 → candidate adapters" 索引
    const nameToAdapters = new Map<string, typeof adapters>();
    for (const def of adapters) {
      for (const cmd of def.fingerprint.commandNames) {
        const key = cmd.toLowerCase();
        if (!nameToAdapters.has(key)) nameToAdapters.set(key, []);
        nameToAdapters.get(key)!.push(def);
      }
    }
    // 2. L1：PATH 扫描
    const pathEntries = this._listPathEntries();
    const candidates: Array<{ entry: PathEntry; adapterDef: any }> = [];
    const unmatchedButKnown: ScanItem[] = [];

    for (const entry of pathEntries) {
      const key = entry.name.toLowerCase();
      const stripped = this._stripExe(key);
      const defs = nameToAdapters.get(key) || nameToAdapters.get(stripped);
      if (defs?.length) {
        candidates.push({ entry, adapterDef: defs[0] });
        nameToAdapters.delete(key);
        nameToAdapters.delete(stripped);
      } else if (this._config.showUnknown && this._looksLikeAiCli(entry.name)) {
        // 展示给用户"未知 AI CLI"
        unmatchedButKnown.push({
          adapterId: null,
          executablePath: entry.fullPath,
          commandName: entry.name,
          version: null,
          authState: 'unknown',
          scannedDepth: 'l1',
        });
      }
    }

    const total = candidates.length;
    let done = 0;
    const results: ScanItem[] = [];

    // 3. 顺序 L2/L3（避免一次 fork 太多进程）
    for (const { entry, adapterDef } of candidates) {
      const item: ScanItem = {
        adapterId: adapterDef.id,
        executablePath: entry.fullPath,
        commandName: entry.name,
        version: null,
        authState: 'unknown',
        scannedDepth: 'l1',
      };

      if (depth === 'l1') {
        // skip
      } else {
        // L2: version
        try {
          item.version = await this._probeVersion(entry.fullPath, adapterDef.fingerprint, timeout);
          item.scannedDepth = 'l2';
        } catch (e: any) {
          item.error = `version probe failed: ${e.message ?? String(e).slice(0, 120)}`;
        }
      }

      if (depth === 'l3') {
        const auth = await this._probeAuth(entry.fullPath, adapterDef.fingerprint, timeout);
        item.authState = auth.state;
        item.authHint = auth.hint;
        if (item.scannedDepth === 'l2') item.scannedDepth = 'l3' as any;
      }

      results.push(item);
      done++;
      this._emitter.emit('scan-progress', { done, total, latest: item });

      const key = `${adapterDef.id}::${entry.fullPath}`;
      const isNew = !this._previousScan.has(key);
      this._previousScan.set(key, item);
      this._emitter.emit('cli-detected', { item, isNew });
    }

    const final = [...results, ...unmatchedButKnown];
    this._emitter.emit('scan-done', final);
    return final;
  }

  async *watchScan(opts?: { depth?: ScanDepth }): AsyncIterable<ScanItem> {
    const resultsP = this.scan(opts);
    const buffer: ScanItem[] = [];
    let resolveNext: ((v: IteratorResult<ScanItem>) => void) | null = null;
    const off = this.on('cli-detected', ({ item }) => {
      if (resolveNext) {
        resolveNext({ value: item, done: false });
        resolveNext = null;
      } else {
        buffer.push(item);
      }
    });
    try {
      while (true) {
        if (buffer.length) {
          yield buffer.shift()!;
          continue;
        }
        const nextP = new Promise<IteratorResult<ScanItem>>(r => (resolveNext = r));
        const doneP = resultsP.then(() => ({ done: true as const, value: undefined }));
        const next = await Promise.race([nextP, doneP]);
        if (next.done) {
          // flush remaining
          for (const rest of buffer) yield rest;
          return;
        }
        yield next.value!;
      }
    } finally {
      off;
    }
  }

  on(event: string, cb: (...args: any[]) => void): this {
    this._emitter.on(event, cb);
    return this;
  }

  // ================ 内部实现 ================
  private _listPathEntries(): PathEntry[] {
    // 5 秒缓存，避免高频 PATH 扫描
    const now = Date.now();
    if (this._pathCache && now - this._pathCache.ts < 5000) return this._pathCache.entries;

    // macOS launchd 后台进程会重置 PATH 到 /usr/bin:/bin:/usr/sbin:/sbin
    // 主动补全常见 bin 目录，确保能扫到 ~/.local/bin/claude、/opt/homebrew/bin/gemini 等
    const rawPath = process.env.PATH ?? '';
    const extraDirs = [
      process.env.HOME ? `${process.env.HOME}/.local/bin` : undefined,
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
    ].filter(Boolean) as string[];
    const missingDirs = extraDirs.filter(d => !rawPath.includes(d));
    const pathEnv = missingDirs.length > 0
      ? [...missingDirs, rawPath].filter(Boolean).join(path.delimiter)
      : rawPath;
    const dirs = pathEnv.split(path.delimiter).filter(Boolean);
    const seen = new Set<string>();
    const entries: PathEntry[] = [];

    for (const dir of dirs) {
      let realDir = dir;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        continue;
      }
      if (seen.has(realDir)) continue;
      seen.add(realDir);

      let files: string[] = [];
      try {
        files = fs.readdirSync(realDir);
      } catch {
        continue;
      }
      for (const name of files) {
        const full = path.join(realDir, name);
        try {
          const stat = fs.statSync(full);
          if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        } catch {
          continue;
        }
        let isExec = true;
        try {
          fs.accessSync(full, fs.constants.X_OK);
        } catch {
          isExec = false;
        }
        entries.push({ name, fullPath: full, isExecutable: isExec });
      }
    }
    this._pathCache = { ts: now, entries };
    return entries;
  }

  private _stripExe(name: string): string {
    return name.endsWith('.exe') ? name.slice(0, -4) : name;
  }

  private _looksLikeAiCli(name: string): boolean {
    // 启发式：名字匹配常见 AI CLI 关键字段（用于"未匹配 adapter 但仍展示"）
    const n = name.toLowerCase();
    const keywords = [
      'gpt', 'ai', 'llm', 'agent', 'claude', 'codex', 'copilot', 'kimi', 'qwen',
      'goose', 'mistral', 'snow', 'openclaw', 'claw', 'cursor', 'hermes', 'code',
      'devin', 'factory', 'droid', 'vibe', 'nano', 'bot', 'cli'
    ];
    return keywords.some(k => n === k || n.startsWith(k + '-') || n.endsWith('-' + k));
  }

  private async _probeVersion(
    executablePath: string,
    fp: CliFingerprint,
    timeout: number,
  ): Promise<string | null> {
    const args = fp.versionArgs ?? ['--version'];
    const { stdout, exitCode } = await this._safeExec(executablePath, args, timeout);
    if (exitCode !== 0 && !stdout) return null;
    const text = (stdout || '').trim();
    if (!text) return null;
    if (fp.versionPattern) {
      const m = text.match(fp.versionPattern);
      if (m) return m[1] ?? m[0];
    }
    // fallback：抓第一个类似版本号的 token
    const m = text.match(/(\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.]+)?)/);
    return m ? m[1] : text.split(/\s+/)[0];
  }

  private async _probeAuth(
    executablePath: string,
    fp: CliFingerprint,
    timeout: number,
  ): Promise<{ state: AuthState; hint?: string }> {
    // a) env vars（强证据：命中即认为已登录）
    if (fp.envVars?.some(v => process.env[v])) return { state: 'authenticated' };

    // b) config paths（弱证据：只表示"曾配置过"，不等同于已登录/凭证有效）
    //    不立即返回，让后续 authCheck 给出更准确定性判断；若最后没有 authCheck，再退化为 unknown
    let weakState: AuthState = 'unauthenticated';
    if (fp.configPaths?.length) {
      for (const p of fp.configPaths) {
        const expanded = p.replace(/^~/, os.homedir());
        try {
          if (fs.existsSync(expanded)) {
            weakState = 'unknown';
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    // c) authCheck command（强证据：优先以正则/exitCode 结果为准）
    if (fp.authCheck) {
      try {
        const parts = fp.authCheck.cmd.split(/\s+/);
        const actualCmd = parts.shift()!;
        const cmd = actualCmd.includes(path.sep)
          ? actualCmd
          : this._resolveInSameDirOrPath(executablePath, actualCmd) ?? executablePath;
        const { stdout, stderr, exitCode } = await this._safeExec(cmd, parts, timeout);
        const out = `${stdout}\n${stderr}`;
        if (fp.authCheck.expectExpired && fp.authCheck.expectExpired.test(out))
          return { state: 'expired', hint: '凭证已过期，请重新登录' };
        if (fp.authCheck.expectUnauthenticated && fp.authCheck.expectUnauthenticated.test(out)) {
          return { state: 'unauthenticated', hint: `请执行 \`${fp.authCheck.cmd.replace('status', 'login')}\`` };
        }
        if (fp.authCheck.expectAuthenticated && fp.authCheck.expectAuthenticated.test(out))
          return { state: 'authenticated' };
        if (exitCode === 0) return { state: 'authenticated' };
        return { state: 'unauthenticated' };
      } catch (e: any) {
        // authCheck 抛错不能 100% 代表凭证无效，降级为 unknown（但至少保留 hint）
        return {
          state: 'unknown',
          hint: `auth check failed: ${String(e.message ?? e).slice(0, 60)}`,
        };
      }
    }

    // 没有 authCheck → 退回弱判断
    return { state: weakState };
  }

  private _resolveInSameDirOrPath(executablePath: string, name: string): string | null {
    const candidates = [path.join(path.dirname(executablePath), name), name];
    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** 最小安全执行：不拼接 shell，使用 execFile 语义。实际 DSH 里应替换为 ctx.subprocess.exec。 */
  private async _safeExec(
    file: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    // macOS launchd 后台进程会重置 PATH；补全常见 bin 目录确保能找到 claude/gemini/codex
    const scanEnv = { ...process.env };
    {
      const extraPaths = [
        process.env.HOME ? `${process.env.HOME}/.local/bin` : undefined,
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
      ].filter(Boolean) as string[];
      const cur = scanEnv.PATH || '';
      const missing = extraPaths.filter(p => !cur.includes(p));
      if (missing.length > 0) {
        scanEnv.PATH = [...missing, cur].filter(Boolean).join(':');
      }
    }
    // 优先走 DSH subprocess（如果有）—— 必须走 safeGetCtx，避免 Cordis proxy 抛「cannot get subprocess without inject」
    try {
      const sp: any = safeGetCtx(this._ctx, 'subprocess');
      if (sp && typeof sp.exec === 'function') {
        try {
          const r = await sp.exec(file, args, {
            timeout: timeoutMs,
            rejectOnNonZeroExit: false,
            env: scanEnv,
          });
          return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? null };
        } catch (e: any) {
          // DSH subprocess 执行失败时，降级到本机 child_process
          return await this._safeExecNative(file, args, timeoutMs, `subprocess.exec failed: ${String(e?.message ?? e).slice(0, 120)}`);
        }
      }
    } catch { /* 读到 subprocess 被 proxy 拦截时，忽略并走 fallback */ }
    return await this._safeExecNative(file, args, timeoutMs);
  }

  private _safeExecNative(
    file: string,
    args: string[],
    timeoutMs: number,
    priorErrorHint?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return import('node:child_process').then(({ spawn }) => new Promise(resolve => {
      let done = false;
      let stdoutBuf = '';
      let stderrBuf = priorErrorHint ? `[prior hint] ${priorErrorHint}\n` : '';
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill('SIGKILL'); } catch {}
        resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: null });
      }, timeoutMs);
      let child: any;
      try {
        // macOS launchd 后台进程会重置 PATH 到 /usr/bin:/bin:/usr/sbin:/sbin
        // 主动补全常见 bin 目录，确保能找到 ~/.local/bin/claude、/opt/homebrew/bin/gemini 等
        const extraPaths = [
          process.env.HOME ? `${process.env.HOME}/.local/bin` : undefined,
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
        ].filter(Boolean) as string[];
        const env = { ...process.env };
        const currentPath = env.PATH || '';
        const missing = extraPaths.filter(p => !currentPath.includes(p));
        if (missing.length > 0) {
          env.PATH = [...missing, currentPath].filter(Boolean).join(':');
        }
        child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
      } catch (e: any) {
        clearTimeout(t);
        done = true;
        resolve({ stdout: '', stderr: stderrBuf + String(e?.message ?? e), exitCode: null });
        return;
      }
      child.stdout?.on('data', (d: Buffer) => (stdoutBuf += d.toString('utf8').slice(0, 4096)));
      child.stderr?.on('data', (d: Buffer) => (stderrBuf += d.toString('utf8').slice(0, 4096)));
      child.on('error', (e: any) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve({ stdout: stdoutBuf, stderr: stderrBuf + String(e?.message ?? e), exitCode: null });
      });
      child.on('close', (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code });
      });
    }));
  }
}

export function createDefaultScanner(
  ctx: Context,
  registry: RegistryService,
  partialConfig: Partial<ScannerConfig>,
): ScannerService {
  const config: ScannerConfig = {
    defaultDepth: 'l3',
    autoRefreshIntervalSec: 1800,
    timeoutPerCmd: 3000,
    showUnknown: true,
    ...partialConfig,
  };
  return new ScannerServiceImpl(ctx, registry, config);
}
