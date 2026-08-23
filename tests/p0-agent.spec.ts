/**
 * AgentGateway P0 unit tests
 *
 * Strategy: write the mock agent scripts to temp .js files, then launch them with `node /tmp/xxx.js`.
 * No external environment required (no real claude-code/snow-cli). Real files on disk sidestep
 * the double-\n escaping hell of `node -e <src>` (multiline single-quoted strings throw SyntaxError).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createAgentGateway, type AgentGateway } from '../src/core/gateway-agent';
import { createDefaultRegistry } from '../src/core/registry';
import { defineCliAdapter } from '../src/adapters/define';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-agent-p0-'));

function writeAgentScript(filename: string, src: string): string {
  const full = path.join(TMP, filename);
  fs.writeFileSync(full, src, 'utf8');
  return full;
}

// ---- Mock agent scripts (String.raw keeps literal \n unexpanded by the template; what lands on disk is a real \n escape) ----
const JSONRPC_AGENT_JS = writeAgentScript('jsonrpc-agent.js', String.raw`
'use strict';
// ready line: must contain "jsonrpc" + "method"
process.stdout._handle?.setBlocking?.(true);
process.stdout.write('HELLO {"jsonrpc":"2.0","method":"initialize"}\n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0,i); buf = buf.slice(i+1);
    try {
      const req = JSON.parse(line);
      const resp = { jsonrpc: '2.0', id: req.id, result: { pong: req.params?.ping ?? 'ok' } };
      process.stdout.write(JSON.stringify(resp) + '\n');
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
    }
  }
});
setTimeout(() => {}, 600_000);
`);

const LINE_AGENT_JS = writeAgentScript('line-agent.js', String.raw`
'use strict';
process.stdout._handle?.setBlocking?.(true);
process.stdout.write('Snow CLI REPL v0.1\n');
process.stdout.write('Type .help for commands\n');
process.stdout.write('snow> \n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0,i); buf = buf.slice(i+1);
    process.stdout.write('ECHO: ' + line + '\n');
    process.stdout.write('snow> \n');
  }
});
setTimeout(() => {}, 600_000);
`);

function makeFakeCtx(): any {
  return {
    baseDir: '/tmp/dsh-p0-agent',
    logger: { info: () => {}, warn: console.warn, debug: () => {}, error: console.error },
    // no ctx.subprocess.spawn provided -> AgentGateway automatically falls back to node child_process
  };
}

function makeJsonrpcAdapter(overrides: any = {}) {
  return defineCliAdapter({
    id: overrides.id ?? 'jsonrpc-mock',
    name: 'JSONRPC Mock',
    description: 'mock adapter for p0 tests',
    fingerprint: { commandNames: ['node'] },
    capabilities: {
      agent: {
        protocol: 'stdio-jsonrpc',
        spawn: {
          command: 'node',
          argsTemplate: [JSONRPC_AGENT_JS],
          readyPattern: '"jsonrpc"',
          readyTimeoutMs: 5000,
          gracefulShutdownSignal: 'SIGTERM',
          shutdownGraceMs: 500,
        },
      },
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
}

function makeLineAdapter() {
  return defineCliAdapter({
    id: 'line-mock',
    name: 'Line Mock',
    description: 'mock adapter for line-based agent test',
    fingerprint: { commandNames: ['node'] },
    capabilities: {
      agent: {
        protocol: 'line-based',
        spawn: {
          command: 'node',
          argsTemplate: [LINE_AGENT_JS],
          readyPattern: 'snow>',
          readyTimeoutMs: 5000,
          gracefulShutdownSignal: 'SIGTERM',
          shutdownGraceMs: 500,
        },
      },
    },
    quota: { method: { kind: 'unknown' } },
    healthProbe: null,
  });
}

const sessionsLeft: AgentGateway[] = [];

describe('AgentGateway', () => {
  let gw: AgentGateway;
  let reg: any;
  let ctx: any;

  beforeEach(() => {
    ctx = makeFakeCtx();
    reg = new (createDefaultRegistry as any)(ctx, { enabledOverrides: {} });
    gw = createAgentGateway(ctx, reg, {
      defaultReadyTimeoutMs: 5000,
      defaultShutdownGraceMs: 500,
      singletonPerAdapter: true,
    });
    sessionsLeft.push(gw);
  });

  afterAll(async () => {
    for (const g of sessionsLeft) {
      try { await g.stopAll(); } catch {}
    }
  });

  // ---------- basic errors ----------
  it('spawn throws when the adapter does not exist', async () => {
    await expect(gw.spawn('does-not-exist')).rejects.toThrow(/not found/);
  });

  it('spawn throws when the adapter is disabled', async () => {
    const ad = makeJsonrpcAdapter();
    reg.register(ad);
    reg.setEnabled(ad.id, false);
    await expect(gw.spawn(ad.id)).rejects.toThrow(/not enabled/);
  });

  it('spawn throws when the adapter has no agent capability', async () => {
    // Note: defineCliAdapter requires at least one capability (tools or agent).
    // Give it a dummy tools capability to pass define; what we test is that spawn rejects
    // because there is no agent field.
    const noAgent = defineCliAdapter({
      id: 'no-agent', name: 'x', description: 'x',
      fingerprint: { commandNames: ['ls'] },
      capabilities: {
        tools: [{
          dshToolName: 'cli-hub:no-agent:noop',
          description: 'noop',
          inputSchema: { type: 'object' },
          commandMapping: { kind: 'template', template: 'ls' },
          outputParser: 'stdout-text',
        }],
      },
      quota: { method: { kind: 'unknown' } },
      healthProbe: null,
    });
    reg.register(noAgent);
    reg.setEnabled(noAgent.id, true);
    await expect(gw.spawn(noAgent.id)).rejects.toThrow(/no agent capability/);
  });

  // ---------- jsonrpc protocol (claude-code style) ----------
  it('jsonrpc: spawn -> waitReady -> request is routed back by id', async () => {
    const ad = makeJsonrpcAdapter();
    reg.register(ad);
    const ses = await gw.spawn(ad.id);
    expect(ses.protocol).toBe('stdio-jsonrpc');
    expect(ses.status).toBe('ready');
    expect(typeof ses.pid).toBe('number');
    expect(ses.pid!).toBeGreaterThan(1);
    expect(ses.readyAt).toBeDefined();

    const r = await ses.request('ping', { ping: 42 }, 5000);
    expect(r).toEqual({ pong: 42 });

    const list = gw.listSessions();
    expect(list.find(s => s.adapterId === ad.id)).toBeTruthy();
  }, 15_000);

  it('jsonrpc: singleton reuses the same session (no two parallel instances by default)', async () => {
    const ad = makeJsonrpcAdapter();
    reg.register(ad);
    const s1 = await gw.spawn(ad.id);
    const s2 = await gw.spawn(ad.id);
    expect(s2.sessionId).toBe(s1.sessionId);

    await expect(gw.spawn(ad.id, { reuse: false })).rejects.toThrow(/already running/);
  }, 15_000);

  // ---------- line-based protocol (snow-cli REPL style) ----------
  it('line-based: readyPattern matches the last banner line; send a line -> recv ECHO back', async () => {
    const ad = makeLineAdapter();
    reg.register(ad);
    const ses = await gw.spawn(ad.id);
    expect(ses.protocol).toBe('line-based');
    expect(ses.status).toBe('ready');

    await ses.send('hello world');
    const r = await ses.recv(5000);
    expect(r.line).toBe('ECHO: hello world');
  }, 15_000);

  // ---------- shutdown ----------
  it('shutdown: after the call the process exits and the session disappears from the list', async () => {
    const ad = makeJsonrpcAdapter();
    reg.register(ad);
    const ses: any = await gw.spawn(ad.id);
    const pid: number = ses.pid;

    await ses.shutdown();
    expect(['shutdown', 'error']).toContain(ses.status);

    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    expect(alive).toBe(false);
  }, 12_000);

  it('stopAll closes multiple sessions on different protocols at once', async () => {
    const a = makeJsonrpcAdapter();
    const b = makeLineAdapter();
    reg.register(a); reg.register(b);
    await gw.spawn(a.id);
    await gw.spawn(b.id);
    expect(gw.listSessions().length).toBe(2);

    await gw.stopAll();
    await new Promise(r => setTimeout(r, 1500));
    expect(gw.listSessions().length).toBe(0);
  }, 15_000);

  it('agent stop returns true/false', async () => {
    expect(await gw.stop('no-such-adapter')).toBe(false);

    const ad = makeJsonrpcAdapter();
    reg.register(ad);
    await gw.spawn(ad.id);
    expect(await gw.stop(ad.id)).toBe(true);
  }, 12_000);
});
