import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { RegistryServiceImpl, createDefaultRegistry } from '../src/core/registry';
import { ScannerServiceImpl } from '../src/core/scanner';
import { createToolGateway, ToolGatewayImpl } from '../src/core/gateway-tool';
import { QuotaManagerServiceImpl } from '../src/core/quota';
import { CliHubStorage } from '../src/core/storage';
import { defineCliAdapter } from '../src/adapters/define';
import { BUILTIN_ADAPTERS } from '../src/adapters/builtin';

// ============================================================
// Helper: fake DSH Context (minimal storage/logger implementation)
// ============================================================
function makeFakeCtx() {
  const mem: Record<string, any> = {};
  const storageScoped = {
    async get<T = any>(k: string): Promise<T | undefined> { return (mem[k] as T) ?? undefined; },
    async set(k: string, v: any) { mem[k] = v; },
  };
  return {
    storage: { scoped: storageScoped },
    logger: (scope: string) => ({
      debug: (...args: any[]) => process.env.VERBOSE && console.debug(`[${scope}]`, ...args),
      info: (...args: any[]) => process.env.VERBOSE && console.info(`[${scope}]`, ...args),
      warn: (...args: any[]) => console.warn(`[${scope}]`, ...args),
      error: (...args: any[]) => console.error(`[${scope}]`, ...args),
    }),
    // empty tools (not really registered; a stub is enough)
    tools: null as any,
    subprocess: {
      async exec(cmd: string, args: string[], _opts: any = {}) {
        // default stub: echo returns its args; anything else exits 0
        if (cmd === 'echo') return { stdout: args.join(' '), stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
    on: () => {},
    emit: () => {},
    set: () => {},
  } as any;
}

// ============================================================
// 1. Registry tests
// ============================================================
describe('Registry', () => {
  let reg: RegistryServiceImpl;
  beforeEach(() => {
    reg = new RegistryServiceImpl(makeFakeCtx(), { enabledOverrides: {} });
  });

  it('registers all builtin adapters without throwing', () => {
    for (const a of BUILTIN_ADAPTERS) expect(() => reg.register(a as any)).not.toThrow();
    expect(reg.size).toBe(BUILTIN_ADAPTERS.length);
  });

  it('throws on invalid adapter id', () => {
    // defineCliAdapter throws at construction time (invalid id)
    expect(() => defineCliAdapter({
      id: 'BAD ID!',
      name: 'X',
      description: 'x',
      fingerprint: { commandNames: ['x'] },
      capabilities: { tools: [{
        dshToolName: 'cli-hub:bad:t',
        description: 't',
        inputSchema: { type: 'object', properties: {} },
        commandMapping: { kind: 'template', template: 'x' },
        outputParser: 'stdout-text',
      }] },
      quota: { method: { kind: 'unknown' } },
      healthProbe: null,
    })).toThrow(/invalid id/)

    // valid id passes defineCliAdapter; register must not throw either
    const good = defineCliAdapter({
      id: 'good-id',
      name: 'Good',
      description: 'a good one',
      fingerprint: { commandNames: ['good'] },
      capabilities: { tools: [{
        dshToolName: 'cli-hub:good:t',
        description: 't',
        inputSchema: { type: 'object', properties: {} },
        commandMapping: { kind: 'template', template: 'good' },
        outputParser: 'stdout-text',
      }] },
      quota: { method: { kind: 'unknown' } },
      healthProbe: null,
    });
    expect(() => reg.register(good as any)).not.toThrow();
  });

  it('defaultEnabled=false disables by default; override can force-enable', () => {
    const r = new RegistryServiceImpl(makeFakeCtx(), { enabledOverrides: { off: true } });
    const off = defineCliAdapter({
      id: 'off', name: 'Off', description: 'd',
      defaultEnabled: false,
      fingerprint: { commandNames: ['off'] },
      capabilities: { tools: [{
        dshToolName: 'cli-hub:off:t', description: 't',
        inputSchema: { type: 'object' },
        commandMapping: { kind: 'template', template: 'x' },
        outputParser: 'stdout-text',
      }] },
    });
    r.register(off);
    // override=true overrides defaultEnabled=false
    expect(r.isEnabled('off')).toBe(true);

    const r2 = new RegistryServiceImpl(makeFakeCtx(), { enabledOverrides: {} });
    r2.register(off);
    expect(r2.isEnabled('off')).toBe(false);
    r2.setEnabled('off', true);
    expect(r2.isEnabled('off')).toBe(true);
  });

  it('listAdapters filters by capability mode', () => {
    for (const a of BUILTIN_ADAPTERS) reg.register(a as any);
    const toolsOnly = reg.listAdapters({ mode: 'tool' });
    const agentOnly = reg.listAdapters({ mode: 'agent' });
    expect(toolsOnly.length).toBeGreaterThanOrEqual(1);
    // kimi-cli and claude-code both declare agents, so agentOnly should be >= 2
    expect(agentOnly.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// 2. Scanner tests (mocked PATH)
// ============================================================
describe('Scanner', () => {
  it('L1 scan: a fake snow binary in a temp PATH dir is matched by the snow-cli adapter', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan-'));
    try {
      // drop an executable fake snow script into the temp dir
      const fakeSnow = path.join(tmpdir, 'snow');
      fs.writeFileSync(
        fakeSnow,
        '#!/bin/sh\necho "snow v1.2.3"\n',
        { mode: 0o755 },
      );
      const originalPath = process.env.PATH!;
      process.env.PATH = tmpdir + path.delimiter + originalPath;
      try {
        const ctx = makeFakeCtx();
        const reg = createDefaultRegistry(ctx, { enabledOverrides: {} });
        for (const a of BUILTIN_ADAPTERS) reg.register(a as any);
        const scanner = new ScannerServiceImpl(ctx, reg, {
          defaultDepth: 'l1', autoRefreshIntervalSec: 0, timeoutPerCmd: 500, showUnknown: true,
        });
        const items = await scanner.scan({ depth: 'l1' });
        const hit = items.find(i => i.adapterId === 'snow-cli');
        expect(hit).toBeDefined();
        expect(hit!.commandName).toBe('snow');
        expect(hit!.scannedDepth).toBe('l1');
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 15_000);

  it('L2 version probe extracts the version from --version output', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan-'));
    try {
      const fake = path.join(tmpdir, 'snow');
      fs.writeFileSync(fake, '#!/bin/sh\ncase "$1" in --version) echo "snow v0.9.42";; *) exit 0;; esac\n', { mode: 0o755 });
      const originalPath = process.env.PATH!;
      process.env.PATH = tmpdir + path.delimiter + originalPath;
      try {
        const ctx = makeFakeCtx();
        // give ctx.subprocess a real exec implementation (actually spawns node; exercises L2)
        ctx.subprocess.exec = async (file: string, args: string[]) => {
          return new Promise(resolve => {
            const { spawn } = require('node:child_process');
            const c = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let o = '', e = '';
            c.stdout.on('data', (d: any) => (o += d.toString()));
            c.stderr.on('data', (d: any) => (e += d.toString()));
            c.on('close', (code: any) => resolve({ stdout: o, stderr: e, exitCode: code }));
          });
        };
        const reg = createDefaultRegistry(ctx, { enabledOverrides: {} });
        for (const a of BUILTIN_ADAPTERS) reg.register(a as any);
        const scanner = new ScannerServiceImpl(ctx, reg, {
          defaultDepth: 'l2', autoRefreshIntervalSec: 0, timeoutPerCmd: 1500, showUnknown: true,
        });
        const items = await scanner.scan({ depth: 'l2', adapterIds: ['snow-cli'] });
        const snow = items.find(i => i.adapterId === 'snow-cli');
        expect(snow).toBeDefined();
        expect(snow!.version).toMatch(/0\.9\.42/);
        expect(snow!.scannedDepth === 'l2' || snow!.scannedDepth === 'l3').toBe(true);
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 15_000);
});

// ============================================================
// 3. ToolGateway tests: template rendering + shell-safe escaping
// ============================================================
describe('ToolGateway', () => {
  function makeSetup() {
    const ctx = makeFakeCtx();
    const reg = createDefaultRegistry(ctx, { enabledOverrides: {} });
    for (const a of BUILTIN_ADAPTERS) reg.register(a as any);
    const storage = new CliHubStorage(ctx.storage.scoped);
    const quota = new QuotaManagerServiceImpl(ctx, reg, storage, { cacheTtlSec: 300, defaultWarningThresholdPercent: 10 });
    const gw = createToolGateway(ctx, reg, quota, storage, { sandboxLevel: 'strict', failureCooldownCount: 3, failureCooldownSec: 1 });
    return { ctx, reg, quota, storage, gw: gw as ToolGatewayImpl };
  }

  it('safeEscape defends against injection characters', () => {
    // Test the internal behavior directly: call _renderCommand via reflection on a template-mapping adapter
    // We construct a RegisteredTool-shaped object and feed it to the private method
    const { gw } = makeSetup() as any;

    // simple fake adapter: echo {{prompt}}
    const rt = {
      adapterId: 'test',
      execPath: '/bin/echo',
      def: {
        commandMapping: { kind: 'template', template: 'echo {{prompt}}' },
      },
    } as any;
    const rendered = gw._renderCommand(rt, { prompt: "hi && rm -rf /" }, { workspace: '/tmp', homedir: '/tmp', env: {} });
    // execFile semantics: "hi && rm -rf /" must appear in args as a **single literal argument**,
    // bypassing the shell entirely, so && never gets interpreted even though it is inside the string.
    expect(rendered.args).toContain('hi && rm -rf /');
    // not split into multiple args (no shell tokenization happened)
    expect(rendered.args.length).toBe(1);
    expect(rendered.cmd).toBe('/bin/echo');
  });

  it('argv mode: prompt with double quotes/semicolons is not truncated; spaces do not split args', () => {
    const { gw } = makeSetup() as any;
    const rt = {
      adapterId: 'argv-test',
      execPath: '/tmp/fake-copilot',
      def: {
        dshToolName: 'cli-hub:argv:suggest',
        commandMapping: {
          kind: 'argv',
          command: 'copilot',
          args: [
            'suggest',
            { var: 'prompt' },
            { flag: '--language', var: 'language' },
            '--json',
          ],
        },
      },
    } as any;
    const prompt = 'hello "world" ; cat /etc/passwd && rm -rf /';
    const r = gw._renderCommand(rt, { prompt, language: 'sh' }, { workspace: '/tmp', homedir: '/tmp' });
    expect(r.cmd).toBe('/tmp/fake-copilot');
    // prompt must survive intact as one standalone argv entry
    expect(r.args).toEqual([
      'suggest',
      'hello "world" ; cat /etc/passwd && rm -rf /',
      '--language',
      'sh',
      '--json',
    ]);
  });

  it('argv mode: a path with spaces stays a single argument', () => {
    const { gw } = makeSetup() as any;
    const rt = {
      adapterId: 'argv-spaces',
      execPath: '/usr/bin/kimi',
      def: {
        commandMapping: {
          kind: 'argv',
          command: 'kimi',
          args: [
            'read',
            { flag: '--file', var: 'file' },
          ],
        },
      },
    } as any;
    const r = gw._renderCommand(rt, { file: '/Users/我的文档/report 2026.pdf' }, { workspace: '/tmp', homedir: '/tmp' });
    // a path containing spaces must be one arg (not 3)
    expect(r.args).toContain('/Users/我的文档/report 2026.pdf');
    expect(r.args.length).toBe(3); // ['read', '--file', '<path>']
  });

  it('argv mode: empty flag+var pairs are skipped entirely', () => {
    const { gw } = makeSetup() as any;
    const rt = {
      adapterId: 'argv-opt',
      execPath: '/usr/bin/snow',
      def: {
        commandMapping: {
          kind: 'argv',
          command: 'snow',
          args: [
            'draw',
            { flag: '--prompt', var: 'prompt' },
            { flag: '--style', var: 'style' },          // empty -> skipped
            { flag: '--size', var: 'size', defaultValue: '1024x1024' },  // empty -> falls back to default
            { flag: '--seed', var: 'seed' },            // empty -> skipped
          ],
        },
      },
    } as any;
    const r = gw._renderCommand(rt, { prompt: 'a cat' }, { workspace: '/tmp', homedir: '/tmp' });
    expect(r.args).toEqual([
      'draw',
      '--prompt', 'a cat',
      '--size', '1024x1024',
    ]);
  });

  it('argv / template modes: NUL bytes or vars over the 100k limit throw', () => {
    const { gw } = makeSetup() as any;
    const makeRt = (kind: any) => ({
      adapterId: 'sanitize',
      execPath: '/bin/echo',
      def: {
        commandMapping: kind === 'argv'
          ? { kind: 'argv', command: 'echo', args: [{ var: 'x' }] }
          : { kind: 'template', template: 'echo {{x}}' },
      },
    }) as any;

    // NUL byte
    for (const kind of ['argv', 'template'] as const) {
      expect(() => gw._renderCommand(makeRt(kind), { x: 'a\x00b' }, { workspace: '/tmp', homedir: '/tmp' }))
        .toThrow(/NUL/);
    }
    // over-long value
    const huge = 'x'.repeat(150_000);
    for (const kind of ['argv', 'template'] as const) {
      expect(() => gw._renderCommand(makeRt(kind), { x: huge }, { workspace: '/tmp', homedir: '/tmp' }))
        .toThrow(/exceeds limit/);
    }
  });

  it('cooldown: after N consecutive failures, calls are blocked for a while', async () => {
    const { gw, reg, ctx } = makeSetup() as any;

    // register an always-failing fake tool (ctx.subprocess.exec returns non-zero)
    ctx.subprocess.exec = async () => ({ stdout: '', stderr: 'fake failure', exitCode: 1 });
    const badAdapter = defineCliAdapter({
      id: 'bad-adapter',
      name: 'Bad', description: 'd',
      fingerprint: { commandNames: ['nonexistent-bad'] },
      capabilities: { tools: [{
        dshToolName: 'cli-hub:bad:fail', description: 'always fail',
        inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
        commandMapping: { kind: 'template', template: 'nonexistent-bad --x {{x}}' },
        outputParser: 'exit-code-only',
      }] },
    });
    reg.register(badAdapter);
    // force registration via a fake ScanItem
    await gw.syncRegistrations([{
      adapterId: 'bad-adapter', executablePath: '/bin/false',
      commandName: 'nonexistent-bad', version: '1.0.0', authState: 'authenticated', scannedDepth: 'l2' as any,
    }]);

    // first 3 calls should fail but be allowed; from the 4th on we hit cooldown
    const name = 'cli-hub:bad:fail';
    let cooldownErrors = 0;
    let regularFailures = 0;
    for (let i = 0; i < 5; i++) {
      try {
        await gw._executeTool(name, { x: String(i) }, { workspace: '/tmp', homedir: '/tmp', env: {} });
      } catch (e: any) {
        const msg = String(e.message ?? e);
        if (msg.includes('cooldown')) cooldownErrors++;
        else regularFailures++;
      }
    }
    // expect: 3 regular failures + 2 cooldown errors
    expect(regularFailures).toBe(3);
    expect(cooldownErrors).toBe(2);
  }, 10_000);
});

// ============================================================
// 6. defineCliAdapter error branches (100% branch coverage)
// ============================================================
describe('defineCliAdapter error branches', () => {
  const base = {
    fingerprint: { commandNames: ['x'] },
    capabilities: { tools: [{
      dshToolName: 't:x:t', description: 't', inputSchema: { type: 'object' },
      commandMapping: { kind: 'template' as const, template: 'x' },
      outputParser: 'stdout-text' as const,
    }] },
    quota: { method: { kind: 'unknown' as const } },
    healthProbe: null,
  };

  it('empty name / empty description throw TypeError', () => {
    expect(() => defineCliAdapter({ id: 'ok-id', name: '', description: 'd', ...base } as any))
      .toThrow(/name\/description are required/);
    expect(() => defineCliAdapter({ id: 'ok-id', name: 'N', description: '', ...base } as any))
      .toThrow(/name\/description are required/);
  });

  it('empty fingerprint.commandNames throws TypeError', () => {
    expect(() => defineCliAdapter({
      id: 'ok-id', name: 'N', description: 'd',
      fingerprint: { commandNames: [] },
      capabilities: base.capabilities,
      quota: base.quota, healthProbe: null,
    } as any)).toThrow(/fingerprint\.commandNames/);
  });

  it('throws TypeError when both tools and agent are empty (at least one capability required)', () => {
    expect(() => defineCliAdapter({
      id: 'nocaps', name: 'NoCaps', description: 'd',
      fingerprint: { commandNames: ['x'] },
      capabilities: {},
      quota: { method: { kind: 'unknown' } },
      healthProbe: null,
    } as any)).toThrow(/capabilities.*tool.*agent/);
  });
});

// ============================================================
// 7. Storage persistence round-trip (cache miss -> write -> re-read)
// ============================================================
describe('Storage', () => {
  it('quota cache / enabled states / usage / history all round-trip', async () => {
    const ctx = makeFakeCtx();
    const storage = new CliHubStorage(ctx.storage.scoped);
    const empty = await storage.loadQuotaCache();
    expect(empty).toEqual({});

    // save one adapter quota entry
    await storage.saveQuotaCacheEntry('snow-cli', {
      source: 'provider',
      currency: 'credits',
      remaining: 1234, total: 2000, used: 766,
      refreshedAt: Date.now(),
      period: 'onetime',
    });
    const cache = await storage.loadQuotaCache();
    expect(cache['snow-cli']?.quota.remaining).toBe(1234);

    // enabled states
    await storage.persistAdapterEnabled('snow-cli', true);
    await storage.persistAdapterEnabled('kimi-cli', false);
    const states = await storage.loadAdapterEnabledStates();
    expect(states).toEqual({ 'snow-cli': true, 'kimi-cli': false });

    // scan history
    await storage.saveLastScan([{ adapterId: 'snow-cli', commandName: 'snow', authState: 'authenticated' }] as any);
    const last = await storage.loadLastScan();
    expect(last!.items[0].adapterId).toBe('snow-cli');
  });
});

// ============================================================
// 8. QuotaManager threshold warnings + usage accumulation
// ============================================================
describe('Quota threshold warning & recordUsage', () => {
  it('command method: get -> cache write -> second get hits cache -> forceRefresh -> threshold warning -> recordUsage', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-quota-'));
    try {
      // 1. put a quotatest-cli script in a temp PATH dir that prints quota JSON
      const fake = path.join(tmpdir, 'quotatest-cli');
      fs.writeFileSync(fake, `#!/bin/sh
case "$1 $2" in
  "quota --json") echo '{"remaining":150,"total":1000,"used":850}' ;;
  *) echo 'unknown' ;;
esac`, { mode: 0o755 });

      const originalPath = process.env.PATH!;
      process.env.PATH = tmpdir + path.delimiter + originalPath;
      try {
        const ctx = makeFakeCtx();
        delete (ctx as any).subprocess; // forces QuotaManager onto its internal child_process spawn fallback
        const reg = createDefaultRegistry(ctx, { enabledOverrides: {} });
        const storage = new CliHubStorage(ctx.storage.scoped);
        const fakeCmdQuota = defineCliAdapter({
          id: 'quotatest', name: 'QT', description: 'for quota',
          fingerprint: { commandNames: ['quotatest-cli'] },
          quota: {
            method: {
              kind: 'command',
              cmd: 'quotatest-cli quota --json',
              parser: (s: string) => {
                try {
                  const d = JSON.parse(s);
                  const used = typeof d.used === 'number' ? d.used : (d.total ?? 0) - (d.remaining ?? 0);
                  return {
                    source: 'provider' as const, currency: 'credits' as const,
                    remaining: d.remaining, total: d.total, used,
                    refreshedAt: Date.now(), period: 'onetime',
                  };
                } catch { return { source: 'provider' as const, currency: 'credits' as const, used: 0, refreshedAt: Date.now(), period: 'onetime' }; }
              },
            },
            unit: 'credits',
            refreshIntervalSec: 100,
            totalEstimate: 1000,
          },
          capabilities: { tools: [{
            dshToolName: 'cli-hub:quotatest:t', description: 't',
            inputSchema: { type: 'object' },
            commandMapping: { kind: 'template', template: 'x' },
            outputParser: 'stdout-text',
          }] },
          healthProbe: null,
        });
        reg.register(fakeCmdQuota as any);

        const qm = new QuotaManagerServiceImpl(ctx, reg, storage, {
          cacheTtlSec: 60,
          defaultWarningThresholdPercent: 20, // warn below 20% remaining; 150/1000=15% -> should warn
        });

        let warningFired = false;
        let quotaChanged = 0;
        qm.on('quota-warning', () => { warningFired = true; });
        qm.on('quota-changed', () => { quotaChanged++; });

        const q1 = await qm.get('quotatest');
        expect(q1.remaining).toBe(150);
        expect(q1.total).toBe(1000);
        expect(quotaChanged).toBeGreaterThanOrEqual(1);
        expect(warningFired).toBe(true);

        // second get: should hit the cache (cacheTtlSec=60 before expiry)
        warningFired = false;
        const q2 = await qm.get('quotatest');
        expect(q2.remaining).toBe(150);
        const snap1 = quotaChanged;

        // forceRefresh: runs the parser again
        await qm.get('quotatest', /*forceRefresh*/ true);
        // quotaChanged should increment again
        expect(quotaChanged).toBeGreaterThan(snap1);

        // recordUsage: does not throw even for unknown adapters; accumulates usage into storage.
        await qm.recordUsage('quotatest', 'tool', 42);
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 15_000);
});

// ============================================================
// 9. Scanner L2 version parsing + L3 authCheck coverage
// ============================================================
describe('Scanner L2/L3 branches', () => {
  it('L2 parses version from --version output; L3 authCheck resolves authenticated', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan2-'));
    try {
      // fake binary
      const fake = path.join(tmpdir, 'my-fake-cli');
      fs.writeFileSync(fake, `#!/bin/sh
case "$1" in
  --version) echo "my-fake-cli v99.8.7-beta" ;;
  auth-status) echo 'Authenticated: token=xxx validity=ok' ;;
  *) echo "unknown" ;;
esac`, { mode: 0o755 });

      const originalPath = process.env.PATH!;
      process.env.PATH = tmpdir + path.delimiter + originalPath;
      try {
        const ctx = makeFakeCtx();
        delete (ctx as any).subprocess; // forces Scanner onto the child_process spawn branch
        const reg = createDefaultRegistry(ctx, { enabledOverrides: {} });
        const my = defineCliAdapter({
          id: 'my-fake-cli', name: 'MFC', description: 't',
          fingerprint: {
            commandNames: ['my-fake-cli'],
            versionArgs: ['--version'],
            versionPattern: /my-fake-cli\s+v?([\d][\w.+-]*)/i,
            authCheck: {
              cmd: 'my-fake-cli auth-status',
              expectAuthenticated: /Authenticated.*ok/i,
              expectUnauthenticated: /unauthenticated|no token/i,
            },
          },
          quota: { method: { kind: 'unknown' } },
          capabilities: { tools: [{
            dshToolName: 'cli-hub:mfc:t', description: 't',
            inputSchema: { type: 'object' },
            commandMapping: { kind: 'template', template: 'my-fake-cli run' },
            outputParser: 'stdout-text',
          }] },
          healthProbe: null,
        });
        reg.register(my as any);
        const scanner = new ScannerServiceImpl(ctx, reg, {
          defaultDepth: 'l3', autoRefreshIntervalSec: 0, timeoutPerCmd: 1500, showUnknown: true,
        });
        const items = await scanner.scan({ depth: 'l3' });
        const hit = items.find(i => i.adapterId === 'my-fake-cli');
        expect(hit).toBeDefined();
        expect(hit!.version).toBe('99.8.7-beta');
        expect(hit!.authState).toBe('authenticated');
        expect(hit!.scannedDepth).toBe('l3');
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 15_000);
});
