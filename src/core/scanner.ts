/**
 * ScannerService — automatic local CLI discovery
 *
 * Three-tier scan strategy:
 *   L1 (~20ms): enumerate executable filenames in PATH directories and match them
 *                 against registry fingerprints. No subprocesses spawned, instant results.
 *   L2 (~200ms per match): run `cmd --version` for each L1 hit,
 *                  parse the version with fingerprint.versionPattern.
 *   L3 (~300ms per match): probe login state:
 *                  · check whether fingerprint.envVars exist
 *                  · check whether fingerprint.configPaths exist (~ expanded)
 *                  · run fingerprint.authCheck.cmd and match stdout
 *
 * Exposes a streaming API (watchScan) and a Promise API (scan).
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

  // ================ Public API ================
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

    // 1. Build a "filename → candidate adapters" index
    const nameToAdapters = new Map<string, typeof adapters>();
    for (const def of adapters) {
      for (const cmd of def.fingerprint.commandNames) {
        const key = cmd.toLowerCase();
        if (!nameToAdapters.has(key)) nameToAdapters.set(key, []);
        nameToAdapters.get(key)!.push(def);
      }
    }
    // 2. L1: PATH scan
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
        // Show the user as an "unknown AI CLI"
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

    // 3. Sequential L2/L3 (avoid forking too many processes at once)
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

  // ================ Internal implementation ================
  private _listPathEntries(): PathEntry[] {
    // 5-second cache to avoid high-frequency PATH scans
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
   * Collect all scan directories that may contain AI CLIs.
   *
   * Layers:
   *   1. Directories in $PATH (~/.local/bin etc. already expanded)
   *   2. Common bin dirs under the user's home: ~/.local/bin, ~/.bun/bin, ~/.cargo/bin, ~/go/bin,
   *      ~/.local/share/pnpm, ~/.local/share/npm-global/bin, ~/Library/Python/{ver}/bin
   *   3. CLIs embedded in macOS App bundles:
   *      /Applications/{App}.app/Contents/MacOS/
   *      /Applications/{App}.app/Contents/Resources/app/modules/ai-agent/bin/
   *      /Applications/{App}.app/Contents/Resources/bin/
   *   4. macOS package managers: /usr/local/bin, /opt/homebrew/bin, /opt/homebrew/sbin
   *   5. npm global bin (dynamically query npm config get prefix)
   *   6. npm global lib/node_modules/{pkg}/bin (e.g. the bin of @anthropic-ai/claude-code)
   *
   * No shell subprocesses involved — pure fs calls, fast and safe.
   */
  private _collectScanDirs(): string[] {
    const home = os.homedir();
    const rawPath = process.env.PATH ?? '';
    const pathDirs = rawPath.split(path.delimiter).filter(Boolean);

    // 1/2. Common bin dirs under the user's home
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
      // Python user script dir (CLIs installed via pip install --user live here)
      ...this._pythonUserBins(home),
      // Bin dirs bundled with various IDEs/Agents
      `${home}/.codeium/windsurf/bin`,
      `${home}/.catpawai/bin`,
      `${home}/.grok/bin`,
      `${home}/.opencode/bin`,
      `${home}/.claude/bin`,
      `${home}/.gemini/bin`,
      `${home}/.ollama/bin`,
      `${home}/.config/claude/bin`,
    ];

    // 3. CLIs embedded in macOS App bundles
    const appBundleBins = process.platform === 'darwin'
      ? this._discoverAppBundleBins()
      : [];

    // 4. macOS package managers
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

    // Merge + dedupe (order preserved: PATH first, then home bins, app bundles, pkg mgrs, npm)
    const all = [
      ...pathDirs,
      ...homeBins,
      ...appBundleBins,
      ...pkgManagerBins,
      ...npmBins,
    ].filter((d): d is string => !!d && d.length > 0);

    // Remove duplicates while preserving first-occurrence order
    const dedup = Array.from(new Set(all));
    return dedup;
  }

  /** Probe Python user script dirs (on macOS: ~/Library/Python/3.x/bin, on Linux: ~/.local/bin) */
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
      } catch { /* Python not installed */ }
    } else if (process.platform === 'linux') {
      results.push(`${home}/.local/bin`);
    }
    return results;
  }

  /**
   * Discover CLIs embedded in AI IDE App bundles under macOS /Applications.
   *
   * Apps known to embed CLIs:
   *   - Claude.app        → Contents/MacOS/claude (symlink)
   *   - Gemini.app        → Contents/MacOS/gemini
   *   - OpenCode.app       → Contents/MacOS/opencode
   *   - Ollama.app         → Contents/MacOS/ollama
   *   - TRAE SOLO CN.app   → Contents/Resources/app/modules/ai-agent/bin/agent-tool-host, ctx-cli
   *   - Cursor.app         → Contents/Resources/app/bin/cursor
   *   - Windsurf.app       → Contents/Resources/app/bin/windsurf
   *   - Zed.app            → Contents/Resources/app/bin/zed
   *
   * These binaries are not necessarily on PATH; they must be enumerated proactively to be found.
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
            // Only verify the directory exists; the L1 main loop stats/execs each entry
            const s = fs.statSync(c);
            if (s.isDirectory()) results.push(c);
          } catch { /* skip if missing */ }
        }
      }
    }
    return results;
  }

  /**
   * Discover npm global bin directories.
   *
   * Priority:
   *   1. npm config get prefix (requires a fork, avoid calling it inside the scan loop)
   *   2. Infer from common default paths:
   *      - homebrew node:    /opt/homebrew
   *      - nvm/volta:        $HOME/.nvm/versions/node/{ver}/bin, $HOME/.volta/bin
   *      - n manager:        /usr/local/n/versions/node/{ver}/bin
   *      - nodenv:           $HOME/.nodenv/versions/{ver}/bin
   *   3. Resolve symlink targets of $HOME/.local/lib/node_modules/{pkg}/{bin or package.json#bin}
   *      (many CLIs installed via npm i -g have bin names that differ from the package name,
   *      e.g. @anthropic-ai/claude-code)
   */
  private _discoverNpmGlobalBins(home: string): string[] {
    const results: string[] = [];
    // Common npm prefix candidates
    const prefixCandidates = [
      `${home}/.local`,                              // user-level npm prefix
      `${home}/.npm-global`,
      '/usr/local',                                  // system npm
      '/opt/homebrew',                               // Apple Silicon homebrew
      `${home}/.volta`,
    ];
    for (const prefix of prefixCandidates) {
      results.push(`${prefix}/bin`);
    }
    // nvm: enumerate all versions
    try {
      const nvmVersions = `${home}/.nvm/versions/node`;
      for (const v of fs.readdirSync(nvmVersions)) {
        results.push(`${nvmVersions}/${v}/bin`);
      }
    } catch { /* nvm not installed */ }
    // nodenv
    try {
      const nodenv = `${home}/.nodenv/versions`;
      for (const v of fs.readdirSync(nodenv)) {
        results.push(`${nodenv}/${v}/bin`);
      }
    } catch { /* nodenv not installed */ }

    // Resolve package bins under npm prefix/lib/node_modules (where bin name differs from package name)
    for (const prefix of prefixCandidates) {
      const nmDir = `${prefix}/lib/node_modules`;
      try {
        const scopes = fs.readdirSync(nmDir);
        for (const scope of scopes) {
          // scope may be an @xxx directory or a direct package
          const scopePath = path.join(nmDir, scope);
          let stat;
          try { stat = fs.statSync(scopePath); } catch { continue; }
          if (!stat.isDirectory()) continue;
          if (scope.startsWith('@')) {
            // Enumerate packages under the scope
            let pkgDirs: string[] = [];
            try { pkgDirs = fs.readdirSync(scopePath); } catch { continue; }
            for (const pkg of pkgDirs) {
              const pkgPath = path.join(scopePath, pkg);
              const binDir = path.join(pkgPath, 'bin');
              try {
                if (fs.statSync(binDir).isDirectory()) results.push(binDir);
              } catch { /* no bin directory */ }
            }
          } else {
            const binDir = path.join(scopePath, 'bin');
            try {
              if (fs.statSync(binDir).isDirectory()) results.push(binDir);
            } catch { /* no bin directory */ }
          }
        }
      } catch { /* path does not exist */ }
    }
    return results;
  }

  private _stripExe(name: string): string {
    return name.endsWith('.exe') ? name.slice(0, -4) : name;
  }

  private _looksLikeAiCli(name: string): boolean {
    // Heuristic: match name against common AI CLI keywords (for "no adapter matched but still shown")
    const n = name.toLowerCase();
    // Three hit styles: exact match / prefix / suffix
    const keywords = [
      // Generic AI keywords
      'gpt', 'ai', 'llm', 'agent', 'code', 'cli', 'bot', 'pilot', 'devin',
      'factory', 'droid', 'vibe', 'nano',
      // Known AI CLI / IDE vendor product names
      'claude', 'codex', 'copilot', 'gemini', 'kimi', 'qwen', 'grok', 'aider',
      'cline', 'continue', 'cursor', 'windsurf', 'aichat', 'tgpt', 'ollama',
      'litellm', 'goose', 'mistral', 'snow', 'junie', 'trae', 'hermes',
      // Second-party / open-source AI agents
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
    // probePolicy 'skip': executing this binary has side effects (e.g. launcher shims that
    // open a GUI app) — never run it; version stays unknown.
    if (fp.probePolicy === 'skip') return null;
    const args = fp.versionArgs ?? ['--version'];
    const { stdout, exitCode } = await this._safeExec(executablePath, args, timeout);
    if (exitCode !== 0 && !stdout) return null;
    const text = (stdout || '').trim();
    if (!text) return null;
    if (fp.versionPattern) {
      const m = text.match(fp.versionPattern);
      if (m) return m[1] ?? m[0];
    }
    // fallback: grab the first version-like token
    const m = text.match(/(\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.]+)?)/);
    return m ? m[1] : text.split(/\s+/)[0];
  }

  private async _probeAuth(
    executablePath: string,
    fp: CliFingerprint,
    timeout: number,
  ): Promise<{ state: AuthState; hint?: string }> {
    // a) env vars (strong evidence: a hit means logged in)
    if (fp.envVars?.some(v => process.env[v])) return { state: 'authenticated' };

    // b) config paths (weak evidence: only indicates "was configured at some point", not that
    //    the user is logged in / credentials are valid). Don't return immediately — let the
    //    subsequent authCheck give a more definitive verdict; degrade to unknown if there's no authCheck
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

    // c) authCheck command (strong evidence: prefer regex/exitCode results)
    //    Suppressed under probePolicy 'skip' — running the command would execute the binary.
    if (fp.authCheck && fp.probePolicy !== 'skip') {
      try {
        const parts = fp.authCheck.cmd.split(/\s+/);
        const actualCmd = parts.shift()!;
        const cmd = actualCmd.includes(path.sep)
          ? actualCmd
          : this._resolveInSameDirOrPath(executablePath, actualCmd) ?? executablePath;
        const { stdout, stderr, exitCode } = await this._safeExec(cmd, parts, timeout);
        const out = `${stdout}\n${stderr}`;
        if (fp.authCheck.expectExpired && fp.authCheck.expectExpired.test(out))
          return { state: 'expired', hint: 'Credentials expired, please log in again' };
        if (fp.authCheck.expectUnauthenticated && fp.authCheck.expectUnauthenticated.test(out)) {
          return { state: 'unauthenticated', hint: `Please run \`${fp.authCheck.cmd.replace('status', 'login')}\`` };
        }
        if (fp.authCheck.expectAuthenticated && fp.authCheck.expectAuthenticated.test(out))
          return { state: 'authenticated' };
        if (exitCode === 0) return { state: 'authenticated' };
        return { state: 'unauthenticated' };
      } catch (e: any) {
        // An authCheck error doesn't 100% mean credentials are invalid; degrade to unknown (but keep at least a hint)
        return {
          state: 'unknown',
          hint: `auth check failed: ${String(e.message ?? e).slice(0, 60)}`,
        };
      }
    }

    // No authCheck → fall back to weak judgment
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

  /** Minimal safe execution: no shell concatenation, execFile semantics. In real DSH, replace with ctx.subprocess.exec. */
  private async _safeExec(
    file: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    // Windows: npm global bins generate three shims (extensionless sh script / .cmd / .ps1);
    // resolve the extensionless path to a real .cmd/.exe/.bat variant before spawning.
    file = this._resolveWinExecutable(file);
    // macOS launchd background processes reset PATH; add all bin dirs from _collectScanDirs
    // so spawned subprocesses can find ~/.local/bin/claude, /opt/homebrew/bin/gemini, etc.
    const scanEnv = this._withExtendedPath(process.env);
    // Prefer the DSH subprocess (if available) — must go through safeGetCtx to avoid the Cordis proxy throwing "cannot get subprocess without inject"
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
          // When DSH subprocess execution fails, degrade to the native child_process
          return await this._safeExecNative(file, args, timeoutMs, `subprocess.exec failed: ${String(e?.message ?? e).slice(0, 120)}`);
        }
      }
    } catch { /* ignore when reading subprocess is intercepted by the proxy, and use the fallback */ }
    return await this._safeExecNative(file, args, timeoutMs);
  }

  /**
   * On Windows, npm global bins generate three shims: extensionless (sh script), .cmd and .ps1.
   * Node cannot spawn the extensionless sh script or a .cmd directly (EINVAL); .cmd/.bat must go
   * through cmd.exe. This resolves an extensionless path to an actually existing .cmd/.exe/.bat variant.
   */
  private _resolveWinExecutable(file: string): string {
    if (process.platform !== 'win32') return file;
    if (file.toLowerCase().endsWith('.cmd') || file.toLowerCase().endsWith('.bat')) return file;
    if (path.extname(file)) return file;
    for (const ext of ['.cmd', '.exe', '.bat']) {
      try { if (fs.existsSync(file + ext)) return file + ext; } catch { /* ignore */ }
    }
    return file;
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
        // macOS launchd background processes reset PATH to /usr/bin:/bin:/usr/sbin:/sbin
        // Reuse all dirs derived by _collectScanDirs so ~/.local/bin/claude etc. can be found
        const env = this._withExtendedPath(process.env);
        const lower = file.toLowerCase();
        // Windows .cmd/.bat can only execute via cmd.exe; args come from adapter fingerprints
        // (fixed flags), so quote whitespace/special-char args and pass the line verbatim to cmd.
        if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
          const comspec = process.env.ComSpec || 'cmd.exe';
          const line = [file, ...args].map(a => /[\s"&|<>^]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a).join(' ');
          child = spawn(comspec, ['/d', '/s', '/c', line], { stdio: ['ignore', 'pipe', 'pipe'], env, windowsVerbatimArguments: true });
        } else {
          child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
        }
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
   * Inject the extended PATH into env.
   *
   * _safeExec / _safeExecNative use this to give forked subprocesses a complete PATH,
   * so `claude --version` / `kimi auth status` etc. still run when launchd resets PATH.
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
