/**
 * AgentGateway — core of Agent mode: long-lived subprocess management + protocol adaptation
 *
 * Design principles (lessons learned from past experience):
 *  1) No duplicate spawns: dual index by sessionId + adapterId; concurrency limit of 1 per adapterId.
 *  2) Line-based ready matching: no buffer.indexOf, to avoid partial packets where only half of readyPattern arrives and looks "not yet received".
 *  3) Three-stage shutdown: SIGINT → graceMs → SIGTERM → 2s → SIGKILL, eliminating orphan processes.
 *  4) Layered protocols: Session provides two lowest-level abstractions, JsonRpcLine / LineBased; mcp and others build on top.
 *  5) Dual runtime: prefer ctx.subprocess.spawn (DSH's sandboxed version),
 *                 fall back to node child_process.spawn when absent, for easy unit testing.
 */
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Context } from 'cordis';
import type {
  CliAdapterDefinition,
  AgentCapabilityDeclaration,
  AgentProtocol,
} from './types';
import { safeGetCtx } from './safe-get';

// ============================================================
// Public types
// ============================================================
export type AgentSessionStatus =
  | 'spawning'
  | 'waiting-ready'
  | 'ready'
  | 'running'
  | 'shutdown-requested'
  | 'shutdown'
  | 'error';

export interface AgentSession {
  sessionId: string;
  adapterId: string;
  adapterName: string;
  protocol: AgentProtocol;
  status: AgentSessionStatus;
  spawnedAt: number;
  readyAt?: number;
  endedAt?: number;
  /**
   * Send a message to the subprocess; the returned Promise resolves once the message is written.
   * Content depends on protocol:
   *   - jsonrpc: {jsonrpc:'2.0', id, method, params} or {jsonrpc:'2.0', id, result}
   *   - line-based: plain string (\n appended automatically)
   *   - mcp-stdio: same as jsonrpc (MCP 2.0 uses jsonrpc)
   *   - stream-json: one JSON object per line (e.g. Claude Code's stream-json protocol);
   *                  strings are sent as-is, objects are JSON.stringify'd + '\n'
   */
  send(msg: unknown): Promise<void>;
  /**
   * Wait for the next incoming message (parsed object).
   * Protocols:
   *   - jsonrpc: parsed JSON object (request/response/notification)
   *   - line-based: { line: string }
   *   - stream-json: parsed JSON object (one JSON event per line)
   */
  recv(timeoutMs?: number): Promise<any>;
  /** One-shot RPC: send request → wait for the response with matching id → return result or throw */
  request(method: string, params?: any, timeoutMs?: number): Promise<any>;
  /** Wait for ready state (internally uses readyPattern or the first line after startup) */
  waitReady(timeoutMs?: number): Promise<void>;
  /** Graceful shutdown (three stages) */
  shutdown(): Promise<void>;
  /** Subscribe to events: status-change / line / jsonrpc-message / error / exit */
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  /** Last N lines of recent stderr, for debugging */
  tailStderr(n?: number): string;
  /** Process pid (only available with fallback spawn) */
  pid?: number;
}

export interface SpawnOptions {
  /** Extra environment variables (merged with adapter.env; this parameter takes precedence) */
  extraEnv?: Record<string, string>;
  /** Working directory (overrides the workdirVar resolution result) */
  cwd?: string;
  /** DSH tool sharing: expose the DSH tool channel to the subprocess (reserved protocol hook) */
  shareDshTools?: boolean;
  /** Executable path override: e.g. an execPath already obtained from the L2 scan */
  execPath?: string;
}

export interface AgentGateway {
  /**
   * Start an Agent subprocess. If the adapter already has a session that hasn't stopped,
   * reuse and return it by default (singleton per adapter); reuse=false returns a conflict error.
   */
  spawn(adapterId: string, opts?: SpawnOptions & { reuse?: boolean }): Promise<AgentSession>;
  /** Get the current session of an adapter (undefined if none) */
  getSession(adapterId: string): AgentSession | undefined;
  /** List all live sessions */
  listSessions(): Array<{ sessionId: string; adapterId: string; status: AgentSessionStatus; pid?: number; durationMs: number }>;
  /** Stop a session */
  stop(adapterId: string): Promise<boolean>;
  /** Stop all sessions (hook on DSH exit) */
  stopAll(): Promise<void>;
}

// ============================================================
// Internal implementation
// ============================================================
interface SpawnHandle {
  pid?: number;
  stdin: { write: (b: string, cb?: (e?: Error) => void) => void; end?: () => void };
  stdout: NodeJS.ReadableStream | any;
  stderr: NodeJS.ReadableStream | any;
  onExit: Promise<number | null>;
  kill: (signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL') => void;
}

type RuntimeCtx = {
  workspace: string;
  homedir: string;
  env: Record<string, string>;
};

interface AgentGatewayConfig {
  /** Default ready timeout */
  defaultReadyTimeoutMs?: number;
  /** Default shutdown grace period */
  defaultShutdownGraceMs?: number;
  /** Whether to enforce singleton per adapter */
  singletonPerAdapter?: boolean;
  /** sandboxLevel passed through to ctx.subprocess */
  sandboxLevel?: 'default' | 'strict';
}

export class AgentGatewayImpl implements AgentGateway {
  private _emitter = new EventEmitter();
  private _sessions = new Map<string, AgentSessionImpl>(); // sessionId → session
  private _byAdapter = new Map<string, AgentSessionImpl>(); // adapterId → singleton session
  private _config: Required<Pick<AgentGatewayConfig,
    'defaultReadyTimeoutMs' | 'defaultShutdownGraceMs' | 'singletonPerAdapter'>>;

  constructor(
    private _ctx: Context,
    private _registry: { get: (id: string) => CliAdapterDefinition | undefined; isEnabled: (id: string) => boolean },
    private _config0: AgentGatewayConfig = {},
  ) {
    this._config = {
      defaultReadyTimeoutMs: _config0.defaultReadyTimeoutMs ?? 15_000,
      defaultShutdownGraceMs: _config0.defaultShutdownGraceMs ?? 3_000,
      singletonPerAdapter: _config0.singletonPerAdapter ?? true,
    };
  }

  // ---- Public API ----
  async spawn(adapterId: string, opts: SpawnOptions & { reuse?: boolean } = {}): Promise<AgentSession> {
    const def = this._registry.get(adapterId);
    if (!def) throw new Error(`[cli-hub] agent adapter not found: ${adapterId}`);
    if (!this._registry.isEnabled(adapterId)) throw new Error(`[cli-hub] adapter not enabled: ${adapterId}`);
    if (!def.capabilities.agent) throw new Error(`[cli-hub] adapter has no agent capability: ${adapterId}`);

    const existing = this._byAdapter.get(adapterId);
    if (existing && !['shutdown', 'error'].includes(existing.status)) {
      if (opts.reuse !== false) return existing;
      throw new Error(`[cli-hub] agent session already running for ${adapterId}; stop first or reuse=true`);
    }

    const rctx: RuntimeCtx = {
      workspace: safeGetCtx(this._ctx, 'baseDir') || process.cwd(),
      homedir: (process as any).env.HOME || (process as any).env.USERPROFILE || '/tmp',
      env: { ...(process as any).env },
    };
    // macOS launchd background processes reset PATH to /usr/bin:/bin:/usr/sbin:/sbin
    // Proactively add common bin directories so agent subprocesses can find claude / gemini / codex etc.
    {
      const extraPaths = [
        rctx.homedir ? `${rctx.homedir}/.local/bin` : undefined,
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
      ].filter(Boolean) as string[];
      const cur = rctx.env.PATH || '';
      const missing = extraPaths.filter(p => !cur.includes(p));
      if (missing.length > 0) {
        rctx.env.PATH = [...missing, cur].filter(Boolean).join(':');
      }
    }

    const session = new AgentSessionImpl(
      this._ctx,
      def,
      def.capabilities.agent,
      rctx,
      opts,
      this._config,
    );

    this._sessions.set(session.sessionId, session);
    this._byAdapter.set(adapterId, session);
    session.on('status-change', (st: AgentSessionStatus) => {
      if (st === 'shutdown' || st === 'error') {
        // Delayed cleanup so callers can still read the final status
        setTimeout(() => {
          if (this._byAdapter.get(adapterId) === session) this._byAdapter.delete(adapterId);
        }, 30_000);
      }
    });

    try {
      await session._start();
    } catch (e) {
      // Startup failed: clean up synchronously
      this._sessions.delete(session.sessionId);
      if (this._byAdapter.get(adapterId) === session) this._byAdapter.delete(adapterId);
      throw e;
    }
    return session;
  }

  getSession(adapterId: string): AgentSession | undefined {
    return this._byAdapter.get(adapterId);
  }

  listSessions() {
    return Array.from(this._sessions.values())
      .filter(s => !['shutdown', 'error'].includes(s.status))
      .map(s => ({
        sessionId: s.sessionId,
        adapterId: s.adapterId,
        status: s.status,
        pid: s.pid,
        durationMs: Date.now() - s.spawnedAt,
      }));
  }

  async stop(adapterId: string): Promise<boolean> {
    const s = this._byAdapter.get(adapterId);
    if (!s) return false;
    await s.shutdown();
    return true;
  }

  async stopAll(): Promise<void> {
    const live = Array.from(this._sessions.values())
      .filter(s => !['shutdown', 'error'].includes(s.status));
    await Promise.all(live.map(s => s.shutdown().catch(() => {})));
  }
}

// ============================================================
// AgentSessionImpl
// ============================================================
class AgentSessionImpl extends EventEmitter implements AgentSession {
  readonly sessionId: string;
  readonly adapterId: string;
  readonly adapterName: string;
  readonly protocol: AgentProtocol;
  status: AgentSessionStatus = 'spawning';
  readonly spawnedAt: number;
  readyAt?: number;
  endedAt?: number;
  pid?: number;

  private _handle?: SpawnHandle;
  private _cap: AgentCapabilityDeclaration;
  private _recvQueue: any[] = [];
  private _recvWaiters: Array<{ resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private _rpcPending = new Map<string | number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private _stderrTail: string[] = [];
  private _lines: string[] = [];
  private _nextRpcId = 1;
  private _closed = false;

  constructor(
    private _ctx: Context,
    def: CliAdapterDefinition,
    cap: AgentCapabilityDeclaration,
    private _runtime: RuntimeCtx,
    private _opts: SpawnOptions,
    private _cfg: Required<Pick<AgentGatewayConfig,
      'defaultReadyTimeoutMs' | 'defaultShutdownGraceMs'>>,
  ) {
    super();
    this.sessionId = `ses-${def.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.adapterId = def.id;
    this.adapterName = def.name;
    this.protocol = cap.protocol;
    this._cap = cap;
    this.spawnedAt = Date.now();
  }

  // ---- Lifecycle ----
  async _start() {
    const execPath = this._opts.execPath ?? this._resolveCmd();
    const args = this._renderArgs();
    const cwd = this._opts.cwd ?? (this._cap.spawn.workdirVar
      ? (this._runtime as any)[this._cap.spawn.workdirVar]
      : undefined) ?? this._runtime.workspace;
    const env = {
      ...this._runtime.env,
      ...(this._cap.spawn.env ?? {}),
      ...(this._opts.extraEnv ?? {}),
    };

    this._set('spawning');

    // spawn
    this._handle = await this._doSpawn(execPath, args, cwd, env);
    this.pid = this._handle.pid;

    // Pipeline: stderr is only collected for logging; stdout is parsed per protocol → enqueued
    this._pumpLine(this._handle!.stderr, (line) => this._appendStderr(line));
    this._pumpLine(this._handle!.stdout, (line) => this._onOutLine(line));
    this._handle!.onExit.then((code) => {
      this.endedAt = Date.now();
      const prev = this.status;
      if (!['shutdown', 'error'].includes(prev)) {
        this._set(code === 0 ? 'shutdown' : 'error');
      }
      // Reject all pending waiters
      while (this._recvWaiters.length) {
        const w = this._recvWaiters.shift()!;
        clearTimeout(w.timer);
        w.reject(new Error(`agent exited with code ${code}`));
      }
      for (const [id, p] of this._rpcPending) {
        clearTimeout(p.timer);
        p.reject(new Error(`agent exited with code ${code}; rpc ${String(id)} pending`));
      }
      this._rpcPending.clear();
      this.emit('exit', code);
    }).catch((e) => {
      this._set('error');
      this.emit('error', e);
    });

    this._set('waiting-ready');
    await this.waitReady();
  }

  private _resolveCmd(): string {
    const token = this._cap.spawn.command;
    if (!this._cap.spawn.command) throw new Error(`[cli-hub] ${this.adapterId}: agent spawn.command is empty`);
    // If execPath comes from an external scan, opts.execPath is used directly; this only resolves the token
    return token;
  }

  private _renderArgs(): string[] {
    const vars: Record<string, any> = {
      workspace: this._runtime.workspace,
      homedir: this._runtime.homedir,
      ...(this._opts.shareDshTools ? { SHARE_DSH_TOOLS: '1' } : {}),
    };
    const render = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
      vars[k] == null ? '' : String(vars[k]));
    return this._cap.spawn.argsTemplate.map(render);
  }

  private async _doSpawn(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<SpawnHandle> {
    let sp: any = undefined;
    try { sp = safeGetCtx(this._ctx, 'subprocess'); } catch {}
    if (sp && typeof sp.spawn === 'function') {
      try {
        // DSH-style subprocess.spawn: expected to return {stdin, stdout, stderr, onExit(Promise<code>), kill, pid?}
        const r = await sp.spawn(cmd, args, {
          cwd,
          env,
          stdio: 'pipe',
        });
        return {
          pid: r.pid,
          stdin: r.stdin,
          stdout: r.stdout,
          stderr: r.stderr,
          onExit: Promise.resolve(r.onExit).then((p: any) => p),
          kill: (sig) => { try { r.kill?.(sig); } catch {} },
        };
      } catch { /* On failure, fall back to native spawn */ }
    }
    // fallback: node child_process
    return import('node:child_process').then(async ({ spawn }) => {
      const fs_mod = await import('node:fs');
      // Test scenario: PATH under vitest may not contain 'node' → use process.execPath to point at the current Node executable
      const resolvedCmd = cmd === 'node' ? process.execPath : cmd;
      // spawn fails with ENOENT if cwd doesn't exist; auto mkdir or fall back
      let resolvedCwd = cwd;
      try {
        if (!resolvedCwd || !fs_mod.existsSync(resolvedCwd)) {
          fs_mod.mkdirSync(resolvedCwd || process.cwd(), { recursive: true });
          if (!resolvedCwd) resolvedCwd = process.cwd();
        }
      } catch { resolvedCwd = process.cwd(); }
      const child = spawn(resolvedCmd, args, {
        cwd: resolvedCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Adapt Node native streams to SpawnHandle's minimal interface (satisfies stdin.write(str, cb?) / stdout.on('data') / stderr.on('data'))
      const adaptStream = (s: NodeJS.WritableStream | null): SpawnHandle['stdin'] => ({
        write: (chunk: any, cb?: any) => { try { s?.write(chunk, cb as any); } catch {} },
        end: () => { try { s?.end?.(); } catch {} },
      }) as SpawnHandle['stdin'];
      const handle: SpawnHandle = {
        pid: child.pid,
        stdin: adaptStream(child.stdin),
        stdout: child.stdout as any,
        stderr: child.stderr as any,
        onExit: new Promise<number | null>((resolve) => {
          child.on('close', (code: number | null) => resolve(code));
          child.on('error', () => resolve(-1));
        }),
        kill: (sig) => { try { child.kill(sig); } catch {} },
      };
      return handle;
    });
  }

  // ---- stdout line-level pump (decodes line by line to avoid partial packets) ----
  private _pumpLine(stream: any, onLine: (line: string) => void) {
    if (!stream) return;
    let buf = '';
    const onData = (chunk: any) => {
      if (this._closed) return;
      const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      buf += s;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        try { onLine(line); } catch (e) { this.emit('error', e); }
      }
      // REPL-style readyPattern (e.g. "snow> " without a trailing newline) never gets a \n.
      // If still waiting for ready, hand the current buf (incomplete line) to onLine too, giving _onOutLine a chance to hit readyPattern.
      // One hit is enough (once readyAt is set this no longer triggers), and it doesn't affect regular line parsing afterwards.
      if (buf.length > 0 && this.readyAt === undefined) {
        const beforeReady = this.readyAt;
        try { onLine(buf); } catch (e) { this.emit('error', e); }
        if (this.readyAt !== beforeReady) {
          // Ready matched: the partial buf was consumed as the prompt, don't concatenate it into the next chunk
          buf = '';
        }
      }
    };
    if (typeof stream.on === 'function') {
      stream.on('data', onData);
      stream.on('end', () => {
        if (buf.trim().length) { try { onLine(buf); } catch {} }
        buf = '';
      });
    }
  }

  private _appendStderr(line: string) {
    this._stderrTail.push(line);
    if (this._stderrTail.length > 200) this._stderrTail.shift();
    this.emit('stderr', line);
  }

  private _onOutLine(line: string) {
    this._lines.push(line);
    this.emit('line', line);

    // While not yet ready, every new line attempts to match readyPattern
    if (this.readyAt === undefined) {
      const pat = this._cap.spawn.readyPattern;
      const matched = !pat           // no readyPattern = treat the first line as ready
        || (line.indexOf(pat) !== -1);
      if (matched) {
        this.readyAt = Date.now();
        this._set('ready');
        this.emit('ready');
        // The ready line itself doesn't enter the message queue (prompt/banner)
        return;
      }
      // Other banner lines before ready also don't enter the message queue
      return;
    }

    // Parse per protocol
    // Important: banner/initialization output before ready does **not** enter the message queue, so recv() won't get a banner first
    if (this.readyAt === undefined) return;

    let parsed: any = null;
    if (this.protocol === 'stdio-jsonrpc' || this.protocol === 'mcp-stdio') {
      const trim = line.trim();
      if (!trim) return;
      try { parsed = JSON.parse(trim); } catch { /* ignore non-JSON lines */ return; }
      this.emit('jsonrpc-message', parsed);
      this._enqueue(parsed);
      if (parsed && parsed.id !== undefined && (parsed.result !== undefined || parsed.error)) {
        const p = this._rpcPending.get(parsed.id);
        if (p) {
          clearTimeout(p.timer);
          this._rpcPending.delete(parsed.id);
          if (parsed.error) p.reject(Object.assign(new Error(parsed.error.message || 'rpc error'), parsed.error));
          else p.resolve(parsed.result);
        }
      }
    } else if (this.protocol === 'stream-json') {
      // Claude Code stream-json: one JSON event per line, parsed directly into an object
      const trim = line.trim();
      if (!trim) return;
      try { parsed = JSON.parse(trim); } catch { /* ignore non-JSON lines */ return; }
      this.emit('stream-message', parsed);
      this._enqueue(parsed);
    } else {
      // line-based
      parsed = { line };
      this.emit('line-message', parsed);
      this._enqueue(parsed);
    }
  }

  private _enqueue(msg: any) {
    if (this._recvWaiters.length) {
      const w = this._recvWaiters.shift()!;
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      this._recvQueue.push(msg);
      if (this._recvQueue.length > 512) this._recvQueue.shift();
    }
  }

  // ---- Public API (send/recv/request/waitReady/shutdown) ----
  async send(msg: unknown): Promise<void> {
    if (!this._handle) throw new Error('agent not spawned');
    if (['shutdown', 'error'].includes(this.status)) throw new Error(`agent ${this.status}`);
    const payload = this._serializeSend(msg);
    await new Promise<void>((resolve, reject) => {
      try {
        this._handle!.stdin.write(payload, (e?: Error) => {
          if (e) reject(e); else resolve();
        });
      } catch (e: any) { reject(e); }
    });
  }

  private _serializeSend(msg: unknown): string {
    if (this.protocol === 'stdio-jsonrpc' || this.protocol === 'mcp-stdio') {
      return JSON.stringify(msg) + '\n';
    }
    if (this.protocol === 'stream-json') {
      // stream-json: object → JSON + '\n'; string → as-is + '\n' (skip if already ends with \n)
      if (typeof msg === 'string') return msg.endsWith('\n') ? msg : msg + '\n';
      return JSON.stringify(msg) + '\n';
    }
    // line-based
    return typeof msg === 'string' ? (msg.endsWith('\n') ? msg : msg + '\n') : (String(msg) + '\n');
  }

  recv(timeoutMs: number = 60_000): Promise<any> {
    if (this._recvQueue.length) return Promise.resolve(this._recvQueue.shift()!);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._recvWaiters.findIndex(w => w.resolve === resolve);
        if (idx !== -1) this._recvWaiters.splice(idx, 1);
        reject(new Error('agent.recv timeout'));
      }, timeoutMs);
      this._recvWaiters.push({ resolve, reject, timer });
    });
  }

  async request(method: string, params: any = {}, timeoutMs: number = 60_000): Promise<any> {
    if (this.protocol !== 'stdio-jsonrpc' && this.protocol !== 'mcp-stdio') {
      throw new Error(`request() only supports jsonrpc protocols; got ${this.protocol}`);
    }
    const id = this._nextRpcId++;
    const p = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._rpcPending.delete(id);
        reject(new Error(`agent.request timeout: ${method}`));
      }, timeoutMs);
      this._rpcPending.set(id, { resolve, reject, timer });
    });
    await this.send({ jsonrpc: '2.0', id, method, params });
    return p;
  }

  waitReady(timeoutMs?: number): Promise<void> {
    const ms = timeoutMs ?? this._cap.spawn.readyTimeoutMs ?? this._cfg.defaultReadyTimeoutMs;
    return new Promise<void>((resolve, reject) => {
      if (this.status === 'ready') return resolve();
      if (this.status === 'error' || this.status === 'shutdown') {
        return reject(new Error(`agent ${this.status} before ready`));
      }
      const timer = setTimeout(() => {
        reject(new Error(
          `[cli-hub] agent ready timeout (${ms}ms) for ${this.adapterId}. ` +
          `last stderr: ${this.tailStderr(3)}`,
        ));
      }, ms);
      const onReady = () => { clearTimeout(timer); this.off('error', onErr); resolve(); };
      const onErr = (e: any) => { clearTimeout(timer); this.off('ready', onReady); reject(e); };
      this.once('ready', onReady);
      this.once('error', onErr);
    });
  }

  async shutdown(): Promise<void> {
    if (this._closed) return;
    this._set('shutdown-requested');
    const h = this._handle;
    if (!h) { this._closed = true; this._set('shutdown'); return; }

    const graceMs = this._cap.spawn.shutdownGraceMs ?? this._cfg.defaultShutdownGraceMs;
    const sig1: any = this._cap.spawn.gracefulShutdownSignal ?? 'SIGINT';
    let done = false;
    const finish = () => { if (done) return; done = true; this._closed = true; this._set('shutdown'); };

    // Stage 1: graceful signal + wait for onExit
    h.kill(sig1);
    const onExitP = h.onExit.then(() => finish());
    const stage1 = new Promise<void>((r) => setTimeout(r, graceMs));
    await Promise.race([onExitP, stage1]);
    if (done) return;

    // Stage 2: SIGTERM
    h.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 2000));
    if (done) return;

    // Stage 3: SIGKILL
    h.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 1000));
    finish();
  }

  tailStderr(n: number = 5): string {
    return this._stderrTail.slice(-n).join('\n');
  }

  private _set(st: AgentSessionStatus) {
    if (this.status === st) return;
    this.status = st;
    this.emit('status-change', st);
  }
}

// ============================================================
// Factory function (wired up by index.ts)
// ============================================================
export function createAgentGateway(
  ctx: Context,
  registry: { get: (id: string) => CliAdapterDefinition | undefined; isEnabled: (id: string) => boolean },
  config: AgentGatewayConfig = {},
): AgentGateway {
  return new AgentGatewayImpl(ctx, registry, config);
}
