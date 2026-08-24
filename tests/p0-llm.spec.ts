/**
 * p0-llm.spec — LLM bridge unit tests (provider registration, model
 * auto-detection from scan state, conversation flattening, stream protocol).
 */
import { describe, it, expect, vi } from 'vitest';
import { apply, flattenMessages, pickRunnableTool, buildToolInput, CliHubLlmAdapter } from '../src/llm/index';

function makeDef(id: string, over: any = {}) {
  return {
    id,
    name: id.toUpperCase(),
    description: `def ${id}`,
    fingerprint: { commandNames: [id] },
    capabilities: {
      tools: [{ dshToolName: `cli-hub:${id}:run-task`, description: 'x', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } }, commandMapping: { kind: 'argv', command: id, args: ['{task}'] }, outputParser: 'stdout-text' }],
      ...over.capabilities,
    },
    ...over,
  };
}

function makeCliHub(items: any[], defs: any[] = [], execImpl?: (name: string, input: any) => any): any {
  const registry = new Map(defs.map((d) => [d.id, d]));
  const executed: Array<{ name: string; input: any }> = [];
  return {
    registry: {
      get: (id: string) => registry.get(id),
      isEnabled: (id: string) => !defs.find((d) => d.id === id)?.disabled,
    },
    _scanCache: { items },
    tools: {
      execute: vi.fn(async (name: string, input: any) => {
        executed.push({ name, input });
        return execImpl ? execImpl(name, input) : { content: [{ type: 'text', text: 'tool-result' }] };
      }),
    },
    storage: { loadLastScan: vi.fn(async (): Promise<any> => null) },
    executed,
  };
}

describe('llm bridge — helpers', () => {
  it('flattenMessages puts system into <instructions> and wraps roles', () => {
    const out = flattenMessages(
      [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
        { role: 'user', content: [{ type: 'text', text: 'do it' }] },
      ],
      'be nice',
    );
    expect(out).toContain('<instructions>\nbe nice\n</instructions>');
    expect(out).toContain('<user>\nhello\n</user>');
    expect(out).toContain('<assistant>\nhi there\n</assistant>');
    expect(out.indexOf('<user>')).toBeLessThan(out.indexOf('<assistant>'));
  });

  it('pickRunnableTool prefers :run-task then falls back to task-schema tools', () => {
    const def = makeDef('x', { capabilities: { tools: [
      { dshToolName: 'cli-hub:x:other', inputSchema: { properties: {} } },
      { dshToolName: 'cli-hub:x:run-task', inputSchema: { properties: { task: { type: 'string' } } } },
    ] } });
    expect(pickRunnableTool(def)?.dshToolName).toBe('cli-hub:x:run-task');
    expect(pickRunnableTool(makeDef('y'))?.dshToolName).toBe('cli-hub:y:run-task');
    expect(pickRunnableTool({ capabilities: { tools: [] } })).toBeNull();
  });

  it('buildToolInput fills other required props from defaults', () => {
    const tool = { dshToolName: 't', inputSchema: { required: ['task', 'model'], properties: { task: {}, model: { defaultValue: 'gpt-x' } } } };
    const input = buildToolInput({}, tool as any, 'PROMPT');
    expect(input.task).toBe('PROMPT');
    expect(input.model).toBe('gpt-x');
  });
});

describe('llm bridge — apply()', () => {
  it('registers provider "cli-hub" when ctx.llm exists; no-ops otherwise', async () => {
    const registered: any = {};
    const ctxWithLlm: any = { llm: { registerAdapter: (p: any, a: any) => { registered.providers = p; registered.adapter = a; return {}; } } };
    await apply(ctxWithLlm, { _cliHub: makeCliHub([]) });
    expect(registered.providers).toEqual(['cli-hub']);

    const calls: any = [];
    const ctxNoLlm: any = {};
    await apply(ctxNoLlm, { _cliHub: makeCliHub([]), __noop: calls.push(1) });
    expect(ctxNoLlm.llm).toBeUndefined();
  });
});

describe('llm bridge — listModels auto-detection', () => {
  it('offers only discovered + authenticated + enabled adapters with runnable tools', async () => {
    const defs = [
      makeDef('claude-code'),
      makeDef('codex'),
      makeDef('ollama'),
    ];
    const items = [
      { adapterId: 'claude-code', authState: 'authenticated' },
      { adapterId: 'codex', authState: 'unauthenticated' }, // excluded: not logged in
      { adapterId: 'ollama', authState: 'authenticated' },
      { adapterId: 'ghost', authState: 'authenticated' },   // excluded: no such def
    ];
    defs[2].disabled = true; // ollama disabled → excluded
    const cliHub = makeCliHub(items, defs);
    const adapter = new CliHubLlmAdapter(cliHub as any);
    const models = await adapter.listModels('cli-hub');
    expect(models.map((m: any) => m.id)).toEqual(['claude-code']);
    expect(models[0].provider).toBe('cli-hub');
    expect(models[0].inputModalities).toEqual(['text']);
  });

  it('falls back to storage.loadLastScan when cache is empty', async () => {
    const cliHub = makeCliHub([], [makeDef('claude-code')]);
    cliHub._scanCache = null;
    cliHub.storage.loadLastScan = vi.fn(async () => ({ ts: 1, items: [{ adapterId: 'claude-code', authState: 'authenticated' }] }));
    const models = await new CliHubLlmAdapter(cliHub as any).listModels('cli-hub');
    expect(models.map((m: any) => m.id)).toEqual(['claude-code']);
  });
});

describe('llm bridge — stream()', () => {
  it('flattens and executes through tools.execute, emits delta + finish(stop)', async () => {
    const cliHub = makeCliHub(
      [{ adapterId: 'claude-code', authState: 'authenticated' }],
      [makeDef('claude-code')],
      () => ({ content: [{ type: 'text', text: 'answer text' }] }),
    );
    const adapter = new CliHubLlmAdapter(cliHub as any);
    const chunks: any[] = [];
    for await (const c of adapter.stream({
      provider: 'cli-hub',
      model: 'claude-code',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
      system: 'sys-prompt',
    })) chunks.push(c);

    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'answer text')).toBe(true);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    expect(cliHub.executed[0].name).toBe('cli-hub:claude-code:run-task');
    expect(cliHub.executed[0].input.task).toContain('<instructions>');
    expect(cliHub.executed[0].input.task).toContain('hello world');
  });

  it('emits finish(error) for unavailable models and CLI execution failures', async () => {
    const failing = makeCliHub([{ adapterId: 'claude-code', authState: 'authenticated' }], [makeDef('claude-code')]);
    failing.tools.execute = vi.fn(async () => { throw new Error('boom'); });
    const adapter = new CliHubLlmAdapter(failing as any);
    const chunks: any[] = [];
    for await (const c of adapter.stream({ provider: 'cli-hub', model: 'claude-code', messages: [{ role: 'user', content: 'x' }] })) chunks.push(c);
    expect(chunks[chunks.length - 1].reason.kind).toBe('error');

    const unknown = new CliHubLlmAdapter(makeCliHub([]) as any);
    const chunks2: any[] = [];
    for await (const c of unknown.stream({ provider: 'cli-hub', model: 'nope', messages: [] })) chunks2.push(c);
    expect(chunks2[chunks2.length - 1].reason.kind).toBe('error');
  });
});
