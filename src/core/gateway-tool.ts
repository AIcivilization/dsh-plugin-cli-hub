/**
 * ToolGateway — Tool mode integration into DSH ctx.tools
 *
 * Workflow:
 *   · syncRegistrations(items) — dynamically register/unregister in ctx.tools based on scan results + adapter capability declarations
 *   · Each declared Tool is bound at registration time with:
 *       1. pre-execute: check adapter.enabled + quota pre-deduction + cooldown
 *       2. execute: command template rendering + subprocess.exec (strict sandbox)
 *       3. post-execute: quota recording + call history + event emission
 *   · unregisterForAdapter(id) — cleanup when the user disables an adapter
 *
 * Security notes:
 *   · {{var}} in templates are all shell-escaped (forbidding &&/`|$/$(/ etc.)
 *   · sandbox strict level: users must explicitly declare needed files as input/output variables
 *   · N consecutive failures → cooldown blocks calls for 30s to prevent burning through the quota
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
  /** Called after a scan completes: register tools for discovered and enabled adapters */
  syncRegistrations(items: ScanItem[]): Promise<void>;
  /** Called when an adapter is disabled */
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
  execPath: string;        // Full CLI path
  def: ToolCapabilityDeclaration;
  cooldown: { failures: number; until: number | null };
  unregister?: () => void; // Unregister handle provided by DSH (if any)
}

// === Variable rendering: execFile semantics = the args array bypasses the shell, {{var}} is replaced directly, no shell escaping ===
//    (Note: escaping is needed if and only if mapping.kind === 'template' and the whole template must go through /bin/sh -c.
//     Here we always use execFile: cmd is an executable file path and args are separate array tokens, so no shell character handling is needed.
//     If an adapter must go through a shell, it should explicitly set args = ['-c', <escaped_script>], cmd = '/bin/sh' in commandMapping.resolver.)
function renderValue(value: unknown): string {
  return value == null ? '' : String(value);
}

/**
 * Safety assertion: every argv string must be a plain JS string, contain no NUL bytes, and be at most 100k long.
 * This avoids execFile low-level issues on any rendering path (argv / template / resolver).
 */
const MAX_ARG_LEN = 100_000;
function sanitizeArg(what: string, v: string, adapterId: string, toolName: string): string {
  if (typeof v !== 'string') {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} must be a string, got ${typeof v}`,
    );
  }
  if (v.length > MAX_ARG_LEN) {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} length ${v.length} exceeds limit ${MAX_ARG_LEN}`,
    );
  }
  if (v.includes('\0')) {
    throw new Error(
      `[cli-hub] ${adapterId}/${toolName}: ${what} contains NUL bytes, refusing to execute`,
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

  // ====== safeGet: use the shared helper to bypass the Cordis inject allowlist ======
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

    // Unregister ones that no longer exist
    for (const [name] of Array.from(this._registered)) {
      if (!newMap.has(name)) {
        this._safeUnregister(name);
      }
    }

    // Register new/existing ones
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

  // ============== Internal ==============
  private async _ensureRegistered(
    name: string,
    entry: { item: ScanItem; tool: ToolCapabilityDeclaration; adapterId: string },
  ): Promise<void> {
    const existing = this._registered.get(name);
    if (existing && existing.execPath === entry.item.executablePath) return;  // Already registered and path unchanged
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
      // When DSH ctx.tools is unavailable (test env / headless minimal build), fall back to no registration;
      // tools can still be invoked via the cli-hub tool exec command.
      return;
    }

    // DSH ToolRuntime.register(ToolDefinition) — always use the register method
    const regFn: ((def: any) => () => void) | undefined =
      typeof toolsApi.register === 'function' ? toolsApi.register.bind(toolsApi) :
      typeof toolsApi.define  === 'function' ? toolsApi.define.bind(toolsApi) :   // Compatible with older versions/other hosts
      undefined;
    if (!regFn) return;

    try {
      // Build a DSH ToolDefinition compatible shape:
      //   { name, description, parameters (JSON Schema), output: { schema, render }, execute(args, exec) }
      const toolDef = {
        name,
        description: entry.tool.description,
        parameters: entry.tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        output: {
          // Output schema: generic text content
          schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          render: (_args: unknown, value: any) => {
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            return [{ type: 'text', text }];
          },
        },
        execute: async (args: unknown, exec: any) => {
          // Adapt two signatures: DSH passes (args, exec), we use (input, runtimeCtx) internally
          const runtimeCtx: RuntimeContext = exec?.runtimeCtx ?? exec ?? {};
          const result = await this._executeTool(name, args, runtimeCtx);
          // ToolDefinition.execute must return a canonical JSON value (rendered by output.render)
          // Our _executeTool returns the { content: [{ type:'text', text }] } format
          // Extract text as the canonical value
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

    // 1. cooldown check
    if (rt.cooldown.until && Date.now() < rt.cooldown.until) {
      throw new Error(
        `[cli-hub] tool ${toolName} failed ${this._config.failureCooldownCount} times in a row, ` +
        `now in cooldown; retry after ${Math.ceil((rt.cooldown.until - Date.now()) / 1000)}s`,
      );
    }

    // 2. Quota pre-check (estimate only, no hard blocking; even depleted is allowed through for the provider to decide)
    let quotaWarned = false;
    try {
      const q = await this._quota.get(rt.adapterId);
      if (q.total != null && q.remaining != null && q.remaining / q.total < 0.05) quotaWarned = true;
    } catch { /* ignore */ }

    // 3. Event + start timing
    const callId = randomUUID().slice(0, 8);
    const started = Date.now();
    this._emitter.emit('tool-called', { id: callId, adapterId: rt.adapterId, toolName, input });

    try {
      // 4. Command mapping
      const cmdLine = this._renderCommand(rt, input, runtimeCtx);
      const timeout = rt.def.timeoutMs ?? 60_000;

      // 5. Execute (prefer ctx.subprocess.exec — must go through safeGetCtx to avoid Cordis proxy interception)
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
        // Fallback: node child_process (only for test/dev)
        const [{ spawn }] = await Promise.all([import('node:child_process')]);
        // macOS launchd background processes reset PATH; add common bin directories back
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

      // 6. Parse output
      const result = this._parseOutput(rt.def, stdout, stderr, exitCode ?? -1, outputFile, runtimeCtx);

      // 7. Success: reset cooldown + record quota + record history
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
      // Fill the __output__ variable (if outputFileVar is declared)
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
          // pair mode: if the variable has a value, pass [flag, value]; otherwise skip
          const v = getVar(item.var, item.defaultValue);
          if (v === undefined || v === null || v === '') continue;
          args.push(sanitizeArg('argv flag', item.flag, adapterId, toolName));
          args.push(sanitizeArg(`argv pair[${item.flag}]`, String(v), adapterId, toolName));
          continue;
        }
        // Bare variable
        let v = getVar(item.var, item.defaultValue);
        if (v === undefined || v === null || v === '') {
          if (item.skipIfEmpty) continue;
          v = '';
        }
        args.push(sanitizeArg(`argv var[${item.var}]`, String(v), adapterId, toolName));
      }
    } else {
      // kind: template (backward compatible, emits a DEPRECATE warning)
      const logger = this._logger();
      logger?.warn?.(
        `[cli-hub] DEPRECATE: adapter ${adapterId} / tool ${toolName} uses kind: 'template' ` +
        `(will be removed in v0.2.0); migrate to kind: 'argv'.`,
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
      // Strip leading/trailing quotes from template string tokens (if a token is a quoted constant, restore it to an unquoted string arg for execFile)
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

    // cmd resolution: basename → replace with the scanned full execPath (to prevent PATH hijacking)
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
        throw new Error(`tool ${def.dshToolName} output is not valid JSON: ${stdout.slice(0, 200)}`);
      }
    } else if (parser === 'exit-code-only') {
      if (exitCode !== 0) throw new Error(`tool ${def.dshToolName} exit ${exitCode}: ${stderr.slice(0, 300)}`);
      value = { exitCode };
    } else {
      value = parser.fn(stdout, stderr, exitCode);
      if (value instanceof Promise) value = this._awaitSync(value);  // Async custom parsers not supported (simplified)
    }
    // With an output file → register the attachment + add its URL to the return value
    if (outputFile && runtimeCtx.registerAttachment) {
      try {
        const a = runtimeCtx.registerAttachment(outputFile);
        value = typeof value === 'object' && value ? { ...value, _attachment: a } : { value, _attachment: a };
      } catch { /* ignore */ }
    }
    if (exitCode !== 0 && parser !== 'exit-code-only') {
      // Non-zero exit but parser not declared as exit-code-only: merge stderr into the return value or throw
      if (typeof value === 'object' && value) value._stderr = stderr;
      else value = { value, _stderr: stderr, _exitCode: exitCode };
    }
    return value;
  }

  private _awaitSync<T>(_p: Promise<T>): T {
    // Simplified: async custom parsers not supported (the type system marks fn as sync; this is just defensive)
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
