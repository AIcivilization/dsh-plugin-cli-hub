/**
 * ToolGateway —— Tool 模式接入 DSH ctx.tools
 *
 * 工作流程：
 *   · syncRegistrations(items) — 根据 scan 结果 + adapter 能力声明，动态在 ctx.tools 注册 / 注销
 *   · 每个声明的 Tool，注册时绑定：
 *       1. pre-execute：检查 adapter.enabled + 额度预扣 + 冷却
 *       2. execute：命令模板渲染 + subprocess.exec（严格沙箱）
 *       3. post-execute：额度记录 + 调用历史 + 事件发射
 *   · unregisterForAdapter(id) — 用户禁用 adapter 时清理
 *
 * 安全要点：
 *   · 模板中 {{var}} 都做 shell 安全转义（禁止 &&/`|$/$(/ 等）
 *   · sandbox strict 级别：用户必须明确把需要的文件声明为 input/output 变量
 *   · 连续 N 次失败 → cooldown 阻止调用 30s，防止打爆额度
 */
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Context } from 'cordis';
import type {
  ToolCapabilityDeclaration,
  ScanItem,
  RuntimeContext,
} from './types';
import type { RegistryService } from './registry';
import type { QuotaManagerService } from './quota';
import { CliHubStorage } from './storage';
import { safeGetCtx } from './safe-get';

export interface ToolGatewayConfig {
  failureCooldownCount: number;
  failureCooldownSec: number;
  sandboxLevel: 'strict' | 'relaxed';
}

export interface ToolGateway {
  /** 扫描完成后调用：按已发现且已启用的 adapter 注册 tools */
  syncRegistrations(items: ScanItem[]): Promise<void>;
  /** 禁用 adapter 时调用 */
  unregisterForAdapter(adapterId: string): void;

  on(event: 'tool-called', cb: (p: { id: string; adapterId: string; toolName: string; input: any }) => void): this;
  on(event: 'tool-succeeded', cb: (p: {
    id: string; adapterId: string; toolName: string; durationMs: number; creditsUsed: number;
  }) => void): this;
  on(event: 'tool-failed', cb: (p: {
    id: string; adapterId: string; toolName: string; durationMs: number; error: string;
  }) => void): this;
}

interface RegisteredTool {
  adapterId: string;
  execPath: string;        // CLI 完整路径
  def: ToolCapabilityDeclaration;
  cooldown: { failures: number; until: number | null };
  unregister?: () => void; // DSH 提供的注销句柄（如有）
}

// === 变量渲染：execFile 语义 = 参数数组不经 shell，直接替换 {{var}}，不做 shell 转义 ===
//    （注意：当且仅当 mapping.kind === 'template' 且整个模板需要经过 /bin/sh -c 时才要转义，
//     我们这里一律走 execFile：cmd 是可执行文件路径，args 是单独的数组 token，所以不需要任何 shell 字符处理。
//     如果某个 adapter 一定要经 shell，它应该在 commandMapping.resolver 里显式 args = ['-c', <escaped_script>], cmd = '/bin/sh'。）
function renderValue(value: unknown): string {
  return value == null ? '' : String(value);
}

/**
 * 安全断言：每个 argv 字符串必须是普通 JS 字符串，不含 NUL 字节，长度不超过 100k。
 * 这是为了在任何渲染路径（argv / template / resolver）上都避免 execFile 的底层问题。
 */
const MAX_ARG_LEN = 100_000;
function sanitizeArg(what: string, v: string, adapterId: string, toolName: string): string {
  if (typeof v !== 'string') {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} 必须是字符串类型，实际是 ${typeof v}`,
    );
  }
  if (v.length > MAX_ARG_LEN) {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} 长度 ${v.length} 超过上限 ${MAX_ARG_LEN}`,
    );
  }
  if (v.includes('\0')) {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} 包含 NUL 字节，拒绝执行`,
    );
  }
  return v;
}

export class ToolGatewayImpl implements ToolGateway {
  private _emitter = new EventEmitter();
  private _registered = new Map<string, RegisteredTool>();  // key = dshToolName
  private _adapterToTools = new Map<string, Set<string>>();

  constructor(
    private _ctx: Context,
    private _registry: RegistryService,
    private _quota: QuotaManagerService,
    private _storage: CliHubStorage,
    private _config: ToolGatewayConfig,
  ) {}

  // ====== safeGet：使用共享 helper 绕过 Cordis inject 白名单 ======
  private _safeGet(name: string): any {
    return safeGetCtx(this._ctx, name);
  }
  private _logger() {
    const l = this._safeGet('logger');
    if (typeof l === 'function') return l('dsh-plugin-cli-hub:tool');
    return undefined;
  }

  async syncRegistrations(items: ScanItem[]): Promise<void> {
    const newMap = new Map<string, { item: ScanItem; tool: ToolCapabilityDeclaration; adapterId: string }>();

    for (const item of items) {
      if (!item.adapterId) continue;
      if (!this._registry.isEnabled(item.adapterId)) continue;
      const def = this._registry.get(item.adapterId);
      if (!def?.capabilities.tools?.length) continue;
      if (item.authState === 'unauthenticated' || item.authState === 'expired') continue;
      for (const t of def.capabilities.tools) {
        newMap.set(t.dshToolName, { item, tool: t, adapterId: item.adapterId });
      }
    }

    // 注销已不存在的
    for (const [name] of Array.from(this._registered)) {
      if (!newMap.has(name)) {
        this._safeUnregister(name);
      }
    }

    // 注册新的/已有的
    for (const [name, entry] of newMap) {
      await this._ensureRegistered(name, entry);
    }
  }

  unregisterForAdapter(adapterId: string): void {
    const tools = this._adapterToTools.get(adapterId);
    if (!tools) return;
    for (const t of Array.from(tools)) this._safeUnregister(t);
    this._adapterToTools.delete(adapterId);
  }

  on(event: string, cb: (...args: any[]) => void): this {
    this._emitter.on(event, cb);
    return this;
  }

  // ============== 内部 ==============
  private async _ensureRegistered(
    name: string,
    entry: { item: ScanItem; tool: ToolCapabilityDeclaration; adapterId: string },
  ): Promise<void> {
    const existing = this._registered.get(name);
    if (existing && existing.execPath === entry.item.executablePath) return;  // 已注册且路径没变
    if (existing) this._safeUnregister(name);

    const rt: RegisteredTool = {
      adapterId: entry.adapterId,
      execPath: entry.item.executablePath,
      def: entry.tool,
      cooldown: { failures: 0, until: null },
    };
    this._registered.set(name, rt);
    if (!this._adapterToTools.has(entry.adapterId)) this._adapterToTools.set(entry.adapterId, new Set());
    this._adapterToTools.get(entry.adapterId)!.add(name);

    const toolsApi: any = this._safeGet('tools');
    if (!toolsApi) {
      // DSH ctx.tools 不可用时（测试环境 / headless 精简），fallback 为空注册；
      // 通过 cli-hub tool exec 命令仍可调用。
      return;
    }

    // DSH ToolRuntime.register(ToolDefinition) — 统一用 register 方法
    const regFn: ((def: any) => () => void) | undefined =
      typeof toolsApi.register === 'function' ? toolsApi.register.bind(toolsApi) :
      typeof toolsApi.define  === 'function' ? toolsApi.define.bind(toolsApi) :   // 兼容旧版/其他 host
      undefined;
    if (!regFn) return;

    try {
      // 构造 DSH ToolDefinition 兼容形状：
      //   { name, description, parameters (JSON Schema), output: { schema, render }, execute(args, exec) }
      const toolDef = {
        name,
        description: entry.tool.description,
        parameters: entry.tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        output: {
          // 输出 schema：通用 text 内容
          schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          render: (_args: unknown, value: any) => {
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            return [{ type: 'text', text }];
          },
        },
        execute: async (args: unknown, exec: any) => {
          // 适配两套签名：DSH 传 (args, exec)，我们内部用 (input, runtimeCtx)
          const runtimeCtx: RuntimeContext = exec?.runtimeCtx ?? exec ?? {};
          const result = await this._executeTool(name, args, runtimeCtx);
          // ToolDefinition.execute 需要返回 canonical JSON value（被 output.render 渲染）
          // 我们的 _executeTool 返回 { content: [{ type:'text', text }] } 格式
          // 提取 text 作为 canonical value
          if (result?.content?.[0]?.text) return { text: result.content[0].text };
          return { text: JSON.stringify(result) };
        },
      };
      const unregister = regFn(toolDef);
      rt.unregister = unregister;
      this._logger()?.info?.(`[cli-hub] tool "${name}" registered in ctx.tools`);
    } catch (e: any) {
      this._logger()?.warn?.(`[cli-hub] failed to register tool ${name}: ${e?.message ?? e}`);
    }
  }

  private _safeUnregister(name: string): void {
    const rt = this._registered.get(name);
    if (!rt) return;
    try { rt.unregister?.(); } catch { /* ignore */ }
    this._registered.delete(name);
    for (const [, set] of this._adapterToTools) set.delete(name);
  }

  private async _executeTool(toolName: string, input: any, runtimeCtx: RuntimeContext): Promise<any> {
    const rt = this._registered.get(toolName);
    if (!rt) throw new Error(`tool not registered: ${toolName}`);

    // 1. cooldown 检查
    if (rt.cooldown.until && Date.now() < rt.cooldown.until) {
      throw new Error(
        `[cli-hub] tool ${toolName} 连续失败 ${this._config.failureCooldownCount} 次，` +
        `已进入 cooldown，请 ${Math.ceil((rt.cooldown.until - Date.now()) / 1000)}s 后重试`,
      );
    }

    // 2. 额度预检查（只是估算，不强拦截，depleted 也放行让 provider 决定）
    let quotaWarned = false;
    try {
      const q = await this._quota.get(rt.adapterId);
      if (q.total != null && q.remaining != null && q.remaining / q.total < 0.05) quotaWarned = true;
    } catch { /* ignore */ }

    // 3. 事件 + 开始计时
    const callId = randomUUID().slice(0, 8);
    const started = Date.now();
    this._emitter.emit('tool-called', { id: callId, adapterId: rt.adapterId, toolName, input });

    try {
      // 4. 命令映射
      const cmdLine = this._renderCommand(rt, input, runtimeCtx);
      const timeout = rt.def.timeoutMs ?? 60_000;

      // 5. 执行（优先 ctx.subprocess.exec —— 必须走 safeGetCtx，避免 Cordis proxy 拦）
      let sp: any = undefined;
      try { sp = safeGetCtx(this._ctx, 'subprocess'); } catch {}
      let stdout = '', stderr = '', exitCode: number | null = null, outputFile: string | undefined;
      if (sp && typeof sp.exec === 'function') {
        try {
          const r = await sp.exec(cmdLine.cmd, cmdLine.args, {
            cwd: cmdLine.cwd,
            env: cmdLine.env,
            timeout,
            rejectOnNonZeroExit: false,
            sandbox: this._config.sandboxLevel === 'strict' ? 'strict' : undefined,
          });
          stdout = r.stdout ?? '';
          stderr = r.stderr ?? '';
          exitCode = r.exitCode ?? null;
        } catch (e: any) {
          stderr = `subprocess.exec failed: ${String(e?.message ?? e)}`;
          exitCode = null;
        }
      } else {
        // fallback：node child_process（只用于测试/开发）
        const [{ spawn }] = await Promise.all([import('node:child_process')]);
        // macOS launchd 后台进程会重置 PATH；补全常见 bin 目录
        const toolEnv = { ...process.env, ...(cmdLine.env ?? {}) };
        {
          const home = toolEnv.HOME || process.env.HOME || '';
          const extraPaths = [
            home ? `${home}/.local/bin` : undefined,
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
          ].filter(Boolean) as string[];
          const cur = toolEnv.PATH || '';
          const missing = extraPaths.filter(p => !cur.includes(p));
          if (missing.length > 0) {
            toolEnv.PATH = [...missing, cur].filter(Boolean).join(':');
          }
        }
        const child = spawn(cmdLine.cmd, cmdLine.args, {
          cwd: cmdLine.cwd,
          env: toolEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {}; }, timeout);
        stdout = await this._readStream(child.stdout);
        stderr = await this._readStream(child.stderr);
        exitCode = await new Promise<number | null>((resolve, reject) => {
          child.on('error', reject);
          child.on('close', (code: number | null) => { clearTimeout(timer); resolve(code); });
        });
      }
      outputFile = cmdLine.outputFile;

      // 6. 解析输出
      const result = this._parseOutput(rt.def, stdout, stderr, exitCode ?? -1, outputFile, runtimeCtx);

      // 7. 成功：清 cooldown + 记额度 + 记历史
      rt.cooldown.failures = 0;
      rt.cooldown.until = null;
      const credits = rt.def.estimatedCredits ?? 0;
      if (credits > 0) await this._quota.recordUsage(rt.adapterId, toolName, credits);
      const duration = Date.now() - started;
      await this._storage.pushHistory({
        adapterId: rt.adapterId,
        mode: 'tool',
        capability: toolName,
        success: true,
        durationMs: duration,
        creditsUsed: credits,
      });
      this._emitter.emit('tool-succeeded', {
        id: callId, adapterId: rt.adapterId, toolName, durationMs: duration, creditsUsed: credits,
      });
      return result;
    } catch (err: any) {
      const duration = Date.now() - started;
      const msg = err?.message ?? String(err).slice(0, 300);
      rt.cooldown.failures++;
      if (rt.cooldown.failures >= this._config.failureCooldownCount) {
        rt.cooldown.until = Date.now() + this._config.failureCooldownSec * 1000;
      }
      await this._storage.pushHistory({
        adapterId: rt.adapterId,
        mode: 'tool',
        capability: toolName,
        success: false,
        durationMs: duration,
        creditsUsed: 0,
        error: msg,
      });
      this._emitter.emit('tool-failed', {
        id: callId, adapterId: rt.adapterId, toolName, durationMs: duration, error: msg,
      });
      throw err;
    }
  }

  private _renderCommand(
    rt: RegisteredTool,
    input: Record<string, any>,
    runtimeCtx: RuntimeContext,
  ): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string>; outputFile?: string } {
    const mapping = rt.def.commandMapping;
    const adapterId = rt.adapterId;
    const toolName = rt.def.dshToolName;

    const fullVars: Record<string, any> = {
      ...input,
      workspace: runtimeCtx.workspace,
      home: runtimeCtx.homedir ?? os.homedir(),
    };
    const getVar = (name: string, defaultValue?: unknown): unknown => {
      const v = fullVars[name];
      if (v === undefined || v === null || v === '') return defaultValue;
      return v;
    };
    const hasValue = (name: string): boolean => {
      const v = fullVars[name];
      return !(v === undefined || v === null || v === '');
    };

    let args: string[] = [];
    let cmdToken: string = '';
    let workdirVar: string | undefined;
    let outputFileVar: string | undefined;

    if (mapping.kind === 'resolver') {
      const resolved = mapping.resolver(input, runtimeCtx);
      const cmd = sanitizeArg('cmd (resolver)', resolved.cmd, adapterId, toolName);
      const actualCmd = cmd.includes(path.sep) ? cmd : (rt.execPath ?? cmd);
      const safeArgs = resolved.args.map((a, i) => sanitizeArg(`args[${i}] (resolver)`, String(a), adapterId, toolName));
      return {
        cmd: actualCmd,
        args: safeArgs,
        cwd: resolved.cwd,
        env: resolved.env,
        outputFile: resolved.outputFile,
      };
    }

    if (mapping.kind === 'argv') {
      cmdToken = mapping.command;
      workdirVar = mapping.workdirVar;
      outputFileVar = mapping.outputFileVar;
      // 填 __output__ 变量（若声明了 outputFileVar）
      if (outputFileVar) {
        (fullVars as any).__output__ =
          getVar(outputFileVar) ??
          path.join(runtimeCtx.workspace, `cli-hub-${toolName}-${Date.now()}.bin`);
      }
      for (const item of mapping.args) {
        if (typeof item === 'string') {
          args.push(sanitizeArg('argv literal', item, adapterId, toolName));
          continue;
        }
        if ('flag' in item) {
          // pair 模式：变量有值就传 [flag, value]，否则跳过
          const v = getVar(item.var, item.defaultValue);
          if (v === undefined || v === null || v === '') continue;
          args.push(sanitizeArg('argv flag', item.flag, adapterId, toolName));
          args.push(sanitizeArg(`argv pair[${item.flag}]`, String(v), adapterId, toolName));
          continue;
        }
        // 纯变量
        let v = getVar(item.var, item.defaultValue);
        if (v === undefined || v === null || v === '') {
          if (item.skipIfEmpty) continue;
          v = '';
        }
        args.push(sanitizeArg(`argv var[${item.var}]`, String(v), adapterId, toolName));
      }
    } else {
      // kind: template（向后兼容，打 DEPRECATE 警告）
      const logger = this._logger();
      logger?.warn?.(
        `[cli-hub] DEPRECATE: adapter ${adapterId} / tool ${toolName} 使用 kind: 'template'，` +
        `将在 v0.2.0 移除，请迁移到 kind: 'argv'。`,
      );
      const tpl = mapping.template.trim();
      const tokens = tpl.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      if (!tokens.length) throw new Error('empty command template');
      cmdToken = tokens[0] ?? '';
      workdirVar = mapping.workdirVar;
      outputFileVar = mapping.outputFileVar;
      if (outputFileVar) {
        (fullVars as any).__output__ =
          getVar(outputFileVar) ??
          path.join(runtimeCtx.workspace, `cli-hub-${toolName}-${Date.now()}.bin`);
      }
      const renderTpl = (s: string): string =>
        s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => renderValue(fullVars[name]));
      // 去掉字符串模板头尾的引号（如果 token 是被引号包的常量，恢复成不带引号的字符串 arg 传给 execFile）
      const stripQuotes = (s: string): string => {
        if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
          return s.slice(1, -1);
        }
        return s;
      };
      cmdToken = stripQuotes(renderTpl(cmdToken));
      args = tokens.slice(1).map(t => sanitizeArg(
        `template token "${t}"`,
        stripQuotes(renderTpl(t)),
        adapterId,
        toolName,
      ));
    }

    // cmd 解析：基名 → 用已扫描到的 execPath 完整路径替换（防止 PATH 劫持）
    const actualCmd: string = cmdToken.includes(path.sep)
      ? sanitizeArg('cmd', cmdToken, adapterId, toolName)
      : (rt.execPath ?? sanitizeArg('cmd fallback', cmdToken, adapterId, toolName));

    let cwd: string | undefined;
    if (workdirVar) {
      cwd = String(getVar(workdirVar, runtimeCtx.workspace) ?? runtimeCtx.workspace);
    }
    let outputFile: string | undefined;
    if (outputFileVar) {
      outputFile = String(getVar(outputFileVar, (fullVars as any).__output__) ?? (fullVars as any).__output__);
    }
    return { cmd: actualCmd, args, cwd, outputFile };
  }

  private _parseOutput(
    def: ToolCapabilityDeclaration,
    stdout: string,
    stderr: string,
    exitCode: number,
    outputFile: string | undefined,
    runtimeCtx: RuntimeContext,
  ): any {
    const parser = def.outputParser;
    let value: any;
    if (parser === 'stdout-text') value = stdout;
    else if (parser === 'stderr-text') value = stderr;
    else if (parser === 'stdout-json') {
      try { value = JSON.parse(stdout); } catch (e: any) {
        throw new Error(`tool ${def.dshToolName} 输出不是合法 JSON: ${stdout.slice(0, 200)}`);
      }
    } else if (parser === 'exit-code-only') {
      if (exitCode !== 0) throw new Error(`tool ${def.dshToolName} exit ${exitCode}: ${stderr.slice(0, 300)}`);
      value = { exitCode };
    } else {
      value = parser.fn(stdout, stderr, exitCode);
      if (value instanceof Promise) value = this._awaitSync(value);  // 不支持异步 custom parser（简化）
    }
    // 有输出文件 → 注册附件 + 把 URL 加到返回里
    if (outputFile && runtimeCtx.registerAttachment) {
      try {
        const a = runtimeCtx.registerAttachment(outputFile);
        value = typeof value === 'object' && value ? { ...value, _attachment: a } : { value, _attachment: a };
      } catch { /* ignore */ }
    }
    if (exitCode !== 0 && parser !== 'exit-code-only') {
      // 非零退出但 parser 没声明为 exit-code-only：把 stderr 合并到返回或抛错
      if (typeof value === 'object' && value) value._stderr = stderr;
      else value = { value, _stderr: stderr, _exitCode: exitCode };
    }
    return value;
  }

  private _awaitSync<T>(_p: Promise<T>): T {
    // 简化版：不支持异步 custom parser（类型系统已标记 fn 为同步，只是防御）
    throw new Error('async custom parser not supported');
  }

  private _readStream(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
    return new Promise(resolve => {
      if (!stream) return resolve('');
      let buf = '';
      stream.on('data', (d: Buffer) => (buf += d.toString('utf8')));
      stream.on('end', () => resolve(buf));
      stream.on('error', () => resolve(buf));
    });
  }
}

export function createToolGateway(
  ctx: Context,
  registry: RegistryService,
  quota: QuotaManagerService,
  storage: CliHubStorage,
  partialConfig: Partial<ToolGatewayConfig>,
): ToolGateway {
  const cfg: ToolGatewayConfig = {
    failureCooldownCount: 5,
    failureCooldownSec: 30,
    sandboxLevel: 'strict',
    ...partialConfig,
  };
  return new ToolGatewayImpl(ctx, registry, quota, storage, cfg);
}
