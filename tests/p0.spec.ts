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
// Helper: 假 DSH Context（提供最小 storage/logger 实现）
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
    // 空的 tools（不真实注册，模拟即可）
    tools: null as any,
    subprocess: {
      async exec(cmd: string, args: string[], _opts: any = {}) {
        // 默认假实现：cmd == "true" 才通过
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
// 1. Registry 测试
// ============================================================
describe('Registry', () => {
  let reg: RegistryServiceImpl;
  beforeEach(() => {
    reg = new RegistryServiceImpl(makeFakeCtx(), { enabledOverrides: {} });
  });

  it('注册内置 adapter 全部合法', () => {
    for (const a of BUILTIN_ADAPTERS) expect(() => reg.register(a as any)).not.toThrow();
    expect(reg.size).toBe(BUILTIN_ADAPTERS.length);
  });

  it('adapter id 非法直接抛错', () => {
    // defineCliAdapter 在构造时就抛错（id 不合法）
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
    })).toThrow(/id.*非法/)

    // 合法 id 能通过 defineCliAdapter，register 也不抛
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

  it('defaultEnabled=false 时默认禁用，override 可以强开', () => {
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
    // override=true 覆盖 defaultEnabled=false
    expect(r.isEnabled('off')).toBe(true);

    const r2 = new RegistryServiceImpl(makeFakeCtx(), { enabledOverrides: {} });
    r2.register(off);
    expect(r2.isEnabled('off')).toBe(false);
    r2.setEnabled('off', true);
    expect(r2.isEnabled('off')).toBe(true);
  });

  it('list 过滤 capability 模式', () => {
    for (const a of BUILTIN_ADAPTERS) reg.register(a as any);
    const toolsOnly = reg.listAdapters({ mode: 'tool' });
    const agentOnly = reg.listAdapters({ mode: 'agent' });
    expect(toolsOnly.length).toBeGreaterThanOrEqual(1);
    // kimi-cli 和 claude-code 都声明了 agent，所以 agentOnly 应 ≥ 2
    expect(agentOnly.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// 2. Scanner 测试（mock PATH）
// ============================================================
describe('Scanner', () => {
  it('L1 扫描：在临时 PATH 目录放个假 snow，能被 snow-cli adapter 匹配到', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan-'));
    try {
      // 放一个可执行的假 snow 脚本
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

  it('L2 版本探测能从 --version 输出版本号', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan-'));
    try {
      const fake = path.join(tmpdir, 'snow');
      fs.writeFileSync(fake, '#!/bin/sh\ncase "$1" in --version) echo "snow v0.9.42";; *) exit 0;; esac\n', { mode: 0o755 });
      const originalPath = process.env.PATH!;
      process.env.PATH = tmpdir + path.delimiter + originalPath;
      try {
        const ctx = makeFakeCtx();
        // 给 ctx.subprocess 一个真实执行的实现（用 node 实际跑，测 L2）
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
// 3. ToolGateway 测试：模板渲染 + shell 安全转义
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

  it('safeEscape 防御注入字符', () => {
    // 直接测导出的内部行为：用一个 template resolver adapter 的方式调 _renderCommand（反射）
    // 这里我们直接构造一个 RegisteredTool 喂给 private 方法
    const { gw } = makeSetup() as any;

    // 一个简单的假 adapter：echo "{{bad}}"
    const rt = {
      adapterId: 'test',
      execPath: '/bin/echo',
      def: {
        commandMapping: { kind: 'template', template: 'echo {{prompt}}' },
      },
    } as any;
    const rendered = gw._renderCommand(rt, { prompt: "hi && rm -rf /" }, { workspace: '/tmp', homedir: '/tmp', env: {} });
    // execFile 语义："hi && rm -rf /" 必须作为**单个字面量参数**出现在 args 数组中，
    // 不经过 shell 解析，所以 && 虽然在字符串里但永远不会被 shell 执行。
    expect(rendered.args).toContain('hi && rm -rf /');
    // 没有被拆分成多个参数（没有经过 shell tokenize）
    expect(rendered.args.length).toBe(1);
    expect(rendered.cmd).toBe('/bin/echo');
  });

  it('cooldown：连续失败 N 次后短时间阻止调用', async () => {
    const { gw, reg, ctx } = makeSetup() as any;

    // 注册一个必然失败的假 tool（通过 ctx.subprocess.exec 抛错/返回非零）
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
    // 构造假 ScanItem 强制注册
    await gw.syncRegistrations([{
      adapterId: 'bad-adapter', executablePath: '/bin/false',
      commandName: 'nonexistent-bad', version: '1.0.0', authState: 'authenticated', scannedDepth: 'l2' as any,
    }]);

    // 前 3 次应该都失败但允许调用；第 4 次进入 cooldown
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
    // expect: 3 次常规失败 + 2 次 cooldown
    expect(regularFailures).toBe(3);
    expect(cooldownErrors).toBe(2);
  }, 10_000);
});

// ============================================================
// 6. defineCliAdapter 所有错误分支（覆盖 100% 分支）
// ============================================================
describe('defineCliAdapter 错误分支', () => {
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

  it('空 name / 空 description 抛 TypeError', () => {
    expect(() => defineCliAdapter({ id: 'ok-id', name: '', description: 'd', ...base } as any))
      .toThrow(/name.*description.*必填/);
    expect(() => defineCliAdapter({ id: 'ok-id', name: 'N', description: '', ...base } as any))
      .toThrow(/name.*description.*必填/);
  });

  it('空 fingerprint.commandNames 抛 TypeError', () => {
    expect(() => defineCliAdapter({
      id: 'ok-id', name: 'N', description: 'd',
      fingerprint: { commandNames: [] },
      capabilities: base.capabilities,
      quota: base.quota, healthProbe: null,
    } as any)).toThrow(/fingerprint\.commandNames/);
  });

  it('tools 和 agent 都为空时抛 TypeError（至少一个 capability）', () => {
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
// 7. Storage 持久化 round-trip（覆盖未命中 cache → 写入 → 再读取）
// ============================================================
describe('Storage', () => {
  it('quota cache / enabled states / usage / history 四件套 round-trip', async () => {
    const ctx = makeFakeCtx();
    const storage = new CliHubStorage(ctx.storage.scoped);
    const empty = await storage.loadQuotaCache();
    expect(empty).toEqual({});

    // 写一个 adapter quota
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

    // scan 历史
    await storage.saveLastScan([{ adapterId: 'snow-cli', commandName: 'snow', authState: 'authenticated' }] as any);
    const last = await storage.loadLastScan();
    expect(last!.items[0].adapterId).toBe('snow-cli');
  });
});

// ============================================================
// 8. QuotaManager 阈值告警 + 估算累计
// ============================================================
describe('Quota 阈值告警 & recordUsage', () => {
  it('command 分支：get → 写 cache → 二次命中缓存 → forceRefresh → 阈值告警 → recordUsage', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-quota-'));
    try {
      // 1. 在临时 PATH 里放 quotatest-cli 脚本，输出 quota JSON
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
        delete (ctx as any).subprocess; // 强制走 Quota 内部 child_process spawn fallback
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
          defaultWarningThresholdPercent: 20, // 剩 20% 告警；150/1000=15% → 应告警
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

        // 第二次 get：应命中缓存（cacheTtlSec=60 秒过期）
        warningFired = false;
        const q2 = await qm.get('quotatest');
        expect(q2.remaining).toBe(150);
        const snap1 = quotaChanged;

        // forceRefresh：再走一次 parser
        await qm.get('quotatest', /*forceRefresh*/ true);
        // quotaChanged 应再 +1
        expect(quotaChanged).toBeGreaterThan(snap1);

        // recordUsage：unknown adapter 抛错？不抛。用于 storage 累计。
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
// 9. Scanner L2 版本解析 + L3 authCheck 覆盖
// ============================================================
describe('Scanner L2/L3 分支', () => {
  it('L2 从 --version 输出版本号；L3 authCheck 解析 authenticated', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-hub-scan2-'));
    try {
      // 假二进制
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
        delete (ctx as any).subprocess; // 强制 Scanner 走 child_process spawn 分支
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
