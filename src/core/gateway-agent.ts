/**
 * AgentGateway —— Agent 模式核心：长生命周期子进程管理 + 协议适配
 *
 * 设计原则（踩坑总结于之前经验）：
 *  1) 不重复 spawn：sessionId + adapterId 双索引，同一 adapterId 要求并发限制为 1。
 *  2) ready 按行匹配：不用 buffer.indexOf，避免半包导致 readyPattern 只来一半"看似没到"。
 *  3) shutdown 三阶段：SIGINT → graceMs → SIGTERM → 2s → SIGKILL，杜绝孤儿进程。
 *  4) 协议分层：Session 内建 JsonRpcLine / LineBased 两种最低层抽象，mcp/其他套娃。
 *  5) 双运行时：优先 ctx.subprocess.spawn（DSH 提供的带沙箱版本），
 *                 缺失时 fallback 到 node child_process.spawn，方便单测。
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
// 对外暴露的类型
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
   * 发送一条消息给子进程；返回 Promise 在消息写入后 resolve。
   * 内容依协议：
   *   - jsonrpc：{jsonrpc:'2.0', id, method, params} 或 {jsonrpc:'2.0', id, result}
   *   - line-based：纯字符串（自动加 \n）
   *   - mcp-stdio：等同 jsonrpc（MCP 2.0 使用 jsonrpc）
   *   - stream-json：每行一个 JSON 对象（如 Claude Code 的 stream-json 协议）
   *                  传字符串原样发送，传对象自动 JSON.stringify + '\n'
   */
  send(msg: unknown): Promise<void>;
  /**
   * 等待下一条输入消息（解析后的对象）。
   * 协议：
   *   - jsonrpc：解析后的 JSON 对象（请求/响应/通知）
   *   - line-based：{ line: string }
   *   - stream-json：解析后的 JSON 对象（每行一个 JSON event）
   */
  recv(timeoutMs?: number): Promise<any>;
  /** 一次性 RPC：发请求 → 等待 id 匹配的响应 → 返回 result 或抛错 */
  request(method: string, params?: any, timeoutMs?: number): Promise<any>;
  /** 等待 ready 状态（内部使用 readyPattern 或启动后第 1 行） */
  waitReady(timeoutMs?: number): Promise<void>;
  /** Graceful shutdown（三阶段）*/
  shutdown(): Promise<void>;
  /** 订阅事件：status-change / line / jsonrpc-message / error / exit*/
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  /** 最近一次 stderr 的最后 N 行，调试用 */
  tailStderr(n?: number): string;
  /** 进程 pid（fallback spawn 才有） */
  pid?: number;
}

export interface SpawnOptions {
  /** 额外环境变量（与 adapter.env 合并，优先本参数） */
  extraEnv?: Record<string, string>;
  /** 工作目录（会覆盖 workdirVar 解析结果） */
  cwd?: string;
  /** DSH 工具共享：给子进程暴露 DSH 工具通道（预留协议钩子） */
  shareDshTools?: boolean;
  /** 可执行文件路径覆盖：如 L2 扫描已得到的 execPath */
  execPath?: string;
}

export interface AgentGateway {
  /**
   * 启动一个 Agent 子进程。若 adapter 已存在未停止的 session，
   * 默认复用并返回（adapter 级别单例）；reuse=false 会返回冲突错误。
   */
  spawn(adapterId: string, opts?: SpawnOptions & { reuse?: boolean }): Promise<AgentSession>;
  /** 获取某 adapter 的当前 session（没有则 undefined） */
  getSession(adapterId: string): AgentSession | undefined;
  /** 列出所有活着的 session */
  listSessions(): Array<{ sessionId: string; adapterId: string; status: AgentSessionStatus; pid?: number; durationMs: number }>;
  /** 停止一个 session */
  stop(adapterId: string): Promise<boolean>;
  /** 停止所有 session（DSH 退出时钩子）*/
  stopAll(): Promise<void>;
}

// ============================================================
// 内部实现
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
  /** 默认准备时间 */
  defaultReadyTimeoutMs?: number;
  /** 默认关断周期 */
  defaultShutdownGraceMs?: number;
  /** 每个 adapter 是否强制单例 */
  singletonPerAdapter?: boolean;
  /** sandboxLevel 透传给 ctx.subprocess */
  sandboxLevel?: 'default' | 'strict';
}

export class AgentGatewayImpl implements AgentGateway {
  private _emitter = new EventEmitter();
  private _sessions = new Map<string, AgentSessionImpl>(); // sessionId → session
  private _byAdapter = new Map<string, AgentSessionImpl>(); // adapterId → 单例 session
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

  // ---- 公共 API ----
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
    // macOS launchd 后台进程会重置 PATH 到 /usr/bin:/bin:/usr/sbin:/sbin
    // 主动补全常见 bin 目录，确保 agent 子进程能找到 claude / gemini / codex 等
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
        // 延迟清理，方便调用方拿最后状态
        setTimeout(() => {
          if (this._byAdapter.get(adapterId) === session) this._byAdapter.delete(adapterId);
        }, 30_000);
      }
    });

    try {
      await session._start();
    } catch (e) {
      // 启动失败：同步清掉
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

  // ---- 生命周期 ----
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

    // 管线：stderr 仅收集日志；stdout 按协议解析 → 入队列
    this._pumpLine(this._handle!.stderr, (line) => this._appendStderr(line));
    this._pumpLine(this._handle!.stdout, (line) => this._onOutLine(line));
    this._handle!.onExit.then((code) => {
      this.endedAt = Date.now();
      const prev = this.status;
      if (!['shutdown', 'error'].includes(prev)) {
        this._set(code === 0 ? 'shutdown' : 'error');
      }
      // 拒绝所有 pending waiter
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
    // 若 execPath 来自外部扫描，会直接用 opts.execPath；这里只负责 token
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
        // DSH 风格 subprocess.spawn：期望返回 {stdin, stdout, stderr, onExit(Promise<code>), kill, pid?}
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
      } catch { /* 失败降级到 native spawn */ }
    }
    // fallback: node child_process
    return import('node:child_process').then(async ({ spawn }) => {
      const fs_mod = await import('node:fs');
      // 测试场景：vitest 里 PATH 可能不含 'node' → 用 process.execPath 指到当前 Node 可执行文件
      const resolvedCmd = cmd === 'node' ? process.execPath : cmd;
      // cwd 不存在时 spawn 会 ENOENT；自动 mkdir 或 fallback
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
      // 把 Node 原生 stream 适配到 SpawnHandle 的极简接口（满足 stdin.write(str, cb?) / stdout.on('data') / stderr.on('data')）
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

  // ---- stdout 行级泵（按行解码，避免半包）----
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
      // REPL 风格的 readyPattern（例如 "snow> " 不以换行结束）永远得不到 \n。
      // 如果依然在等待 ready，把当前 buf（不完整行）也交给 onLine，让 _onOutLine 有机会命中 readyPattern。
      // 命中一次即可（readyAt 设置后下面不再触发），不影响后续常规 line 解析。
      if (buf.length > 0 && this.readyAt === undefined) {
        const beforeReady = this.readyAt;
        try { onLine(buf); } catch (e) { this.emit('error', e); }
        if (this.readyAt !== beforeReady) {
          // ready 已命中：partial buf 作为 prompt 被消费，不再拼接到下一次 chunk
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

    // 只要尚未 ready，任何新行都尝试匹配 readyPattern
    if (this.readyAt === undefined) {
      const pat = this._cap.spawn.readyPattern;
      const matched = !pat           // 无 readyPattern = 首行就认为 ready
        || (line.indexOf(pat) !== -1);
      if (matched) {
        this.readyAt = Date.now();
        this._set('ready');
        this.emit('ready');
        // ready 行本身不进消息队列（prompt/banner）
        return;
      }
      // ready 之前的其他 banner 行也不进入消息队列
      return;
    }

    // 按协议解析
    // 重要：ready 之前的 banner/初始化输出**不进入**消息队列，避免 recv() 先拿到 banner
    if (this.readyAt === undefined) return;

    let parsed: any = null;
    if (this.protocol === 'stdio-jsonrpc' || this.protocol === 'mcp-stdio') {
      const trim = line.trim();
      if (!trim) return;
      try { parsed = JSON.parse(trim); } catch { /* 非 JSON 行忽略 */ return; }
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
      // Claude Code stream-json：每行一个 JSON event，直接解析为对象
      const trim = line.trim();
      if (!trim) return;
      try { parsed = JSON.parse(trim); } catch { /* 非 JSON 行忽略 */ return; }
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

  // ---- 公共 API（send/recv/request/waitReady/shutdown）----
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
      // stream-json：对象 → JSON + '\n'；字符串 → 原样 + '\n'（已有 \n 则不重复）
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

    // 阶段 1：优雅信号 + 等 onExit
    h.kill(sig1);
    const onExitP = h.onExit.then(() => finish());
    const stage1 = new Promise<void>((r) => setTimeout(r, graceMs));
    await Promise.race([onExitP, stage1]);
    if (done) return;

    // 阶段 2：SIGTERM
    h.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 2000));
    if (done) return;

    // 阶段 3：SIGKILL
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
// 工厂函数（给 index.ts 装配）
// ============================================================
export function createAgentGateway(
  ctx: Context,
  registry: { get: (id: string) => CliAdapterDefinition | undefined; isEnabled: (id: string) => boolean },
  config: AgentGatewayConfig = {},
): AgentGateway {
  return new AgentGatewayImpl(ctx, registry, config);
}
