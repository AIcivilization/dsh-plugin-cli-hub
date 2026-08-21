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

    const dirs = this._collectScanDirs();
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

  /**
   * 收集所有可能装了 AI CLI 的扫描目录。
   *
   * 层次：
   *   1. $PATH 中的目录（已展开 ~/.local/bin 等）
   *   2. 用户家目录下的常用 bin：~/.local/bin、~/.bun/bin、~/.cargo/bin、~/go/bin、
   *      ~/.local/share/pnpm、~/.local/share/npm-global/bin、~/Library/Python/{ver}/bin
   *   3. macOS App bundle 内嵌 CLI：
   *      /Applications/{App}.app/Contents/MacOS/
   *      /Applications/{App}.app/Contents/Resources/app/modules/ai-agent/bin/
   *      /Applications/{App}.app/Contents/Resources/bin/
   *   4. macOS 包管理器：/usr/local/bin、/opt/homebrew/bin、/opt/homebrew/sbin
   *   5. npm global bin（动态查 npm config get prefix）
   *   6. npm global lib/node_modules/{pkg}/bin（如 @anthropic-ai/claude-code 的 bin）
   *
   * 不依赖 shell 子进程，纯 fs 调用，速度快且安全。
   */
  private _collectScanDirs(): string[] {
    const home = os.homedir();
    const rawPath = process.env.PATH ?? '';
    const pathDirs = rawPath.split(path.delimiter).filter(Boolean);

    // 1/2. 用户家目录下的常用 bin
    const homeBins: (string | undefined)[] = [
      `${home}/.local/bin`,
      `${home}/.bun/bin`,
      `${home}/.cargo/bin`,
      `${home}/go/bin`,
      `${home}/.local/share/pnpm`,
      `${home}/.local/share/npm-global/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/.deno/bin`,
      `${home}/.foundry/bin`,
      // Python 用户脚本目录（pip install --user 装的 CLI 在这）
      ...this._pythonUserBins(home),
      // 各种 IDE/Agent 自带的 bin 目录
      `${home}/.codeium/windsurf/bin`,
      `${home}/.catpawai/bin`,
      `${home}/.grok/bin`,
      `${home}/.opencode/bin`,
      `${home}/.claude/bin`,
      `${home}/.gemini/bin`,
      `${home}/.ollama/bin`,
      `${home}/.config/claude/bin`,
    ];

    // 3. macOS App bundle 内嵌 CLI
    const appBundleBins = process.platform === 'darwin'
      ? this._discoverAppBundleBins()
      : [];

    // 4. macOS 包管理器
    const pkgManagerBins: (string | undefined)[] = [
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/opt/local/bin',
      '/opt/local/sbin',
    ];

    // 5/6. npm global
    const npmBins = this._discoverNpmGlobalBins(home);

    // 合并 + 去重（保序：PATH 在前，home bin、app bundle、pkg mgr、npm 在后）
    const all = [
      ...pathDirs,
      ...homeBins,
      ...appBundleBins,
      ...pkgManagerBins,
      ...npmBins,
    ].filter((d): d is string => !!d && d.length > 0);

    // 去掉重复，但保留首次出现的顺序
    const dedup = Array.from(new Set(all));
    return dedup;
  }

  /** 探测 Python 用户脚本目录（macOS 上是 ~/Library/Python/3.x/bin，Linux 是 ~/.local/bin） */
  private _pythonUserBins(home: string): string[] {
    const results: string[] = [];
    if (process.platform === 'darwin') {
      const base = `${home}/Library/Python`;
      try {
        const versions = fs.readdirSync(base);
        for (const v of versions) {
          const binDir = path.join(base, v, 'bin');
          results.push(binDir);
        }
      } catch { /* Python 未装 */ }
    } else if (process.platform === 'linux') {
      results.push(`${home}/.local/bin`);
    }
    return results;
  }

  /**
   * 探测 macOS /Applications 下的 AI IDE App bundle 内嵌 CLI。
   *
   * 已知会内嵌 CLI 的 App：
   *   - Claude.app        → Contents/MacOS/claude (软链)
   *   - Gemini.app        → Contents/MacOS/gemini
   *   - OpenCode.app       → Contents/MacOS/opencode
   *   - Ollama.app         → Contents/MacOS/ollama
   *   - TRAE SOLO CN.app   → Contents/Resources/app/modules/ai-agent/bin/agent-tool-host, ctx-cli
   *   - Cursor.app         → Contents/Resources/app/bin/cursor
   *   - Windsurf.app       → Contents/Resources/app/bin/windsurf
   *   - Zed.app            → Contents/Resources/app/bin/zed
   *
   * 这些二进制不一定在 PATH 上，必须主动枚举才能发现。
   */
  private _discoverAppBundleBins(): string[] {
    const results: string[] = [];
    const appsRoot = '/Applications';
    const userApps = `${os.homedir()}/Applications`;
    for (const root of [appsRoot, userApps]) {
      let apps: string[] = [];
      try { apps = fs.readdirSync(root); } catch { continue; }
      for (const app of apps) {
        if (!app.endsWith('.app')) continue;
        const appDir = path.join(root, app);
        const candidates = [
          path.join(appDir, 'Contents', 'MacOS'),
          path.join(appDir, 'Contents', 'Resources', 'bin'),
          path.join(appDir, 'Contents', 'Resources', 'app', 'bin'),
          path.join(appDir, 'Contents', 'Resources', 'app', 'modules', 'ai-agent', 'bin'),
        ];
        for (const c of candidates) {
          try {
            // 只验证目录存在；L1 主循环会逐个 stat/exec
            const s = fs.statSync(c);
            if (s.isDirectory()) results.push(c);
          } catch { /* 不存在则跳过 */ }
        }
      }
    }
    return results;
  }

  /**
   * 探测 npm 全局 bin 目录。
   *
   * 优先级：
   *   1. npm config get prefix（但要 fork，避免在扫描循环里调）
   *   2. 常见默认路径推断：
   *      - homebrew node:    /opt/homebrew
   *      - nvm/volta:        $HOME/.nvm/versions/node/{ver}/bin, $HOME/.volta/bin
   *      - n 管理器:         /usr/local/n/versions/node/{ver}/bin
   *      - nodenv:           $HOME/.nodenv/versions/{ver}/bin
   *   3. 解析 $HOME/.local/lib/node_modules/{pkg}/{bin or package.json#bin} 的软链目标
   *      （很多 CLI 用 npm i -g 装但 bin 名和包名不一致，如 @anthropic-ai/claude-code）
   */
  private _discoverNpmGlobalBins(home: string): string[] {
    const results: string[] = [];
    // 常见 npm prefix 候选
    const prefixCandidates = [
      `${home}/.local`,                              // 用户级 npm prefix
      `${home}/.npm-global`,
      '/usr/local',                                  // 系统 npm
      '/opt/homebrew',                               // Apple Silicon homebrew
      `${home}/.volta`,
    ];
    for (const prefix of prefixCandidates) {
      results.push(`${prefix}/bin`);
    }
    // nvm：枚举所有版本
    try {
      const nvmVersions = `${home}/.nvm/versions/node`;
      for (const v of fs.readdirSync(nvmVersions)) {
        results.push(`${nvmVersions}/${v}/bin`);
      }
    } catch { /* nvm 未装 */ }
    // nodenv
    try {
      const nodenv = `${home}/.nodenv/versions`;
      for (const v of fs.readdirSync(nodenv)) {
        results.push(`${nodenv}/${v}/bin`);
      }
    } catch { /* nodenv 未装 */ }

    // 解析 npm prefix/lib/node_modules 下的包 bin（包名和 bin 名不同的情况）
    for (const prefix of prefixCandidates) {
      const nmDir = `${prefix}/lib/node_modules`;
      try {
        const scopes = fs.readdirSync(nmDir);
        for (const scope of scopes) {
          // scope 可能是 @xxx 目录，也可能是直接包
          const scopePath = path.join(nmDir, scope);
          let stat;
          try { stat = fs.statSync(scopePath); } catch { continue; }
          if (!stat.isDirectory()) continue;
          if (scope.startsWith('@')) {
            // 枚举 scope 下的包
            let pkgDirs: string[] = [];
            try { pkgDirs = fs.readdirSync(scopePath); } catch { continue; }
            for (const pkg of pkgDirs) {
              const pkgPath = path.join(scopePath, pkg);
              const binDir = path.join(pkgPath, 'bin');
              try {
                if (fs.statSync(binDir).isDirectory()) results.push(binDir);
              } catch { /* 无 bin 目录 */ }
            }
          } else {
            const binDir = path.join(scopePath, 'bin');
            try {
              if (fs.statSync(binDir).isDirectory()) results.push(binDir);
            } catch { /* 无 bin 目录 */ }
          }
        }
      } catch { /* 路径不存在 */ }
    }
    return results;
  }

  private _stripExe(name: string): string {
    return name.endsWith('.exe') ? name.slice(0, -4) : name;
  }

  private _looksLikeAiCli(name: string): boolean {
    // 启发式：名字匹配常见 AI CLI 关键字段（用于"未匹配 adapter 但仍展示"）
    const n = name.toLowerCase();
    // 完全匹配 / 前缀 / 后缀 三种命中方式
    const keywords = [
      // 通用 AI 关键字
      'gpt', 'ai', 'llm', 'agent', 'code', 'cli', 'bot', 'pilot', 'devin',
      'factory', 'droid', 'vibe', 'nano',
      // 已知 AI CLI / IDE 厂商产品名
      'claude', 'codex', 'copilot', 'gemini', 'kimi', 'qwen', 'grok', 'aider',
      'cline', 'continue', 'cursor', 'windsurf', 'aichat', 'tgpt', 'ollama',
      'litellm', 'goose', 'mistral', 'snow', 'junie', 'trae', 'hermes',
      // 第二方/开源 AI Agent
      'paperclip', 'freebuff', 'soul', 'catpaw', 'catpawai',
      'openclaw', 'claw', 'acp', 'mcp', 'openai', 'anthropic',
      'harness', 'openclaudia', 'opencode',
    ];
    return keywords.some(k =>
      n === k ||
      n.startsWith(k + '-') ||
      n.endsWith('-' + k) ||
      n.startsWith(k + '.') ||
      n.startsWith(k + '_'),
    );
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
    // macOS launchd 后台进程会重置 PATH；补全 _collectScanDirs 中的所有 bin 目录
    // 确保 spawn 子进程能找到 ~/.local/bin/claude、/opt/homebrew/bin/gemini 等
    const scanEnv = this._withExtendedPath(process.env);
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
        // 复用 _collectScanDirs 推导的全部目录，确保能找到 ~/.local/bin/claude 等
        const env = this._withExtendedPath(process.env);
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

  /**
   * 给 env 注入扩展后的 PATH。
   *
   * _safeExec / _safeExecNative 用这个来给 fork 出来的子进程一个完整的 PATH，
   * 让 `claude --version` / `kimi auth status` 等能在 launchd 重置 PATH 的环境下也能跑。
   */
  private _withExtendedPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const scanDirs = this._collectScanDirs();
    const cur = env.PATH || '';
    const missing = scanDirs.filter(p => !cur.includes(p));
    return {
      ...env,
      PATH: missing.length > 0
        ? [...missing, cur].filter(Boolean).join(path.delimiter)
        : cur,
    };
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
