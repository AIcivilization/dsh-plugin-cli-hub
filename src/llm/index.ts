/**
 * CLI Hub LLM bridge — exposes authenticated local CLIs as DSH model options.
 *
 * Registers a single provider route "cli-hub" on ctx.llm:
 *   - listModels() derives models from the latest scan state: discovered +
 *     authenticated + enabled adapters that own a runnable tool (auto-detection).
 *   - stream() flattens the conversation into one prompt and executes it through
 *     the existing ToolGateway chain (sandbox / quota / cooldown included).
 *     Native-server CLIs (ollama) can later upgrade to direct HTTP without
 *     changing the registration.
 *
 * No API keys are involved — the CLI's own subscription does the work.
 */
import type { Context } from 'cordis';
import { safeGetCtx } from '../core/safe-get';

export const name = 'dsh-plugin-cli-hub/llm';
/** Only meaningful when DSH's llm service exists; apply() guards and no-ops otherwise. */
export const inject = ['llm'];

const PROVIDER_ROUTE = 'cli-hub';

interface ToolCap {
  dshToolName: string;
  inputSchema?: { required?: string[]; properties?: Record<string, any> };
}

/** Latest scan items: shared cache first, persisted storage second. */
async function lastScanItems(cliHub: any): Promise<any[]> {
  try {
    const cached = cliHub?._scanCache;
    if (cached?.items) return cached.items;
    const stored = await cliHub?.storage?.loadLastScan?.();
    if (Array.isArray(stored)) return stored;
    if (Array.isArray(stored?.items)) return stored.items;
  } catch { /* fall through */ }
  return [];
}

function contentToText(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  }
  return '';
}

/** Flatten the conversation into a single prompt for one-shot CLI execution. */
export function flattenMessages(messages: any[], system?: string): string {
  const parts: string[] = [];
  const sys = (system ?? '').trim();
  if (sys) parts.push('<instructions>\n' + sys + '\n</instructions>');
  for (const m of messages ?? []) {
    const text = contentToText(m?.content).trim();
    if (!text) continue;
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    parts.push('<' + role + '>\n' + text + '\n</' + role + '>');
  }
  return parts.join('\n\n');
}

/** Prefer an explicit run-task tool; else any tool whose schema accepts a "task" input. */
export function pickRunnableTool(def: any): ToolCap | null {
  const tools: ToolCap[] = def?.capabilities?.tools ?? [];
  if (!tools.length) return null;
  const byName = tools.find((t) => String(t.dshToolName).endsWith(':run-task'));
  if (byName) return byName;
  return tools.find((t) => !!t.inputSchema?.properties?.task) ?? null;
}

/**
 * Build the tool input: the flattened prompt goes to "task"; every other required
 * property is filled from its declared default so strict schemas still validate.
 */
export function buildToolInput(def: any, tool: ToolCap, prompt: string): Record<string, any> {
  const input: Record<string, any> = { task: prompt };
  const required = tool.inputSchema?.required ?? [];
  for (const key of required) {
    if (key === 'task' || input[key] !== undefined) continue;
    const prop = tool.inputSchema?.properties?.[key] ?? {};
    input[key] = prop.defaultValue ?? prop.default ?? (prop.type === 'integer' || prop.type === 'number' ? 0 : '');
  }
  void def;
  return input;
}

function extractResultText(result: any): string {
  const content = result?.content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => String(b.text ?? ''))
      .join('\n')
      .trim();
  }
  if (typeof result?.text === 'string') return result.text.trim();
  return '';
}

/** Read the process-wide bridge singleton (set by whichever application copy registered first). */
export function getBridge(): any {
  return (globalThis as any).__clihubLlmBridge ?? null;
}

export class CliHubLlmAdapter {
  constructor(private cliHub: any, private logger?: any) {}

  providerInfo(provider: string) {
    // Contract: id must equal the registered route exactly.
    return { id: provider, name: 'CLI Hub (local subscriptions)' };
  }

  // Contract: the runtime calls this unconditionally during registerAdapter.
  // undefined = use the default retry policy.
  providerRetryPolicy(_provider: string): undefined {
    return undefined;
  }

  async listModels(provider: string): Promise<any[]> {
    const items = await lastScanItems(this.cliHub);
    const models: any[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const id = item?.adapterId;
      // One adapter can match several binaries (e.g. codex + codex-code-mode-host) — offer it once.
      if (!id || seen.has(id) || item.authState !== 'authenticated') continue;
      if (this.cliHub.registry?.isEnabled?.(id) === false) continue;
      const def = this.cliHub.registry?.get?.(id);
      if (!def || !pickRunnableTool(def)) continue;
      seen.add(id);
      models.push({
        provider,
        id,
        name: def.name ?? id,
        description: typeof def.description === 'string' ? def.description.slice(0, 120) : undefined,
        inputModalities: ['text'],
      });
    }
    models.sort((a, b) => a.name.localeCompare(b.name));
    return models;
  }

  async resolveModel(provider: string, model: string): Promise<any> {
    const def = this.cliHub.registry?.get?.(model);
    return { provider, id: model, name: def?.name ?? model };
  }

  async *stream(options: any): AsyncGenerator<any> {
    const { model, messages, system, signal } = options;
    if (signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted' } };
      return;
    }
    const def = this.cliHub.registry?.get?.(model);
    const tool = def ? pickRunnableTool(def) : null;
    if (!def || !tool) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: `CLI "${model}" is not available as a model (not discovered/authenticated or has no runnable tool).`, code: 'MODEL_UNAVAILABLE' },
        },
      };
      return;
    }
    const prompt = flattenMessages(messages ?? [], system);
    const input = buildToolInput(def, tool, prompt);
    let result: any;
    try {
      this.logger?.debug?.(`[cli-hub/llm] generate via ${tool.dshToolName}`);
      result = await this.cliHub.tools.execute(tool.dshToolName, input);
    } catch (e: any) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: String(e?.message ?? e), code: 'CLI_EXEC_FAILED' } },
      };
      return;
    }
    const text = extractResultText(result);
    if (!text) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: `CLI "${model}" returned no content.`, code: 'EMPTY_RESPONSE' } },
      };
      return;
    }
    // Delta-only protocol is officially tolerated by the block assembler.
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

let applied = false;

export function apply(ctx: Context, cfg: any = undefined, cliHub3rd: any = undefined) {
  const g: any = globalThis as any;
  g.__clihubLlmStage = 'apply-entered';
  if (applied) { g.__clihubLlmStage = 'skipped-already-applied'; return; }
  applied = true;

  const cliHub = cliHub3rd ?? cfg?._cliHub ?? cfg?.config?._cliHub ?? (ctx as any).cliHub;
  if (!cliHub) {
    (ctx as any)?.logger?.warn?.('[cli-hub/llm] cliHub handle not found; LLM bridge skipped.');
    return;
  }
  const bridge = cliHub as any;

  const doRegister = (): boolean => {
    // Raw ctx.llm reads return undefined on fibers without 'llm' injected;
    // safeGetCtx goes through internal/service/get(false) fallbacks instead.
    g.__clihubLlmStage = 'probing-llm-service';
    let llm: any;
    try {
      // NEVER bare-read ctx.llm here: unauthorized property access throws on
      // Cordis fibers whose inject list omits 'llm'. safeGetCtx bypasses via
      // internal/service/get(name,false) and also works on plain test objects.
      llm = safeGetCtx(ctx as any, 'llm');
    } catch (e: any) {
      g.__clihubLlmStage = 'llm-read-threw:' + String(e?.message ?? e).slice(0, 60);
      return false;
    }
    if (!llm || typeof llm.registerAdapter !== 'function') {
      g.__clihubLlmStage = 'llm-service-absent';
      return false;
    }
    const adapter = new CliHubLlmAdapter(cliHub, (ctx as any)?.logger);
    // The process may hold more than one plugin application (dual-format loading);
    // the bridge singleton lives on globalThis so every copy observes the same state.
    g.__clihubLlmStage = 'calling-registerAdapter';
    try {
      llm.registerAdapter([PROVIDER_ROUTE], adapter);
      g.__clihubLlmBridge = { ok: true, stage: 'registered', route: PROVIDER_ROUTE, adapter, at: Date.now() };
      Object.assign(cliHub, { _llmBridge: g.__clihubLlmBridge });
      (ctx as any)?.logger?.info?.('[cli-hub/llm] provider "cli-hub" registered (models follow authenticated scans).');
      return true;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (g.__clihubLlmBridge?.ok && msg.includes('already registered')) {
        // Another application copy of us already owns the route — that IS the bridge.
        Object.assign(cliHub, { _llmBridge: g.__clihubLlmBridge });
        return true;
      }
      Object.assign(cliHub, { _llmBridge: { ok: false, stage: 'register-failed', route: PROVIDER_ROUTE, error: msg, at: Date.now() } });
      (ctx as any)?.logger?.warn?.('[cli-hub/llm] registerAdapter failed:', msg);
      return true;
    }
  };

  if (doRegister()) return;

  bridge.ok = false;
  bridge.stage = 'waiting-for-llm-service';
  bridge.at = Date.now();
  // The llm service materializes when its own loader entry applies — our sub-plugin
  // mounts earlier. Poll briefly so loader ordering can never silently drop the bridge.
  let tries = 0;
  const timer: any = setInterval(() => {
    tries += 1;
    if (tries > 120) {
      clearInterval(timer);
      Object.assign(bridge, { ok: false, stage: 'llm-service-never-appeared', error: 'gave up after 60s', at: Date.now() });
      return;
    }
    if (doRegister()) clearInterval(timer);
  }, 500);
  if (typeof timer.unref === 'function') timer.unref();
}
