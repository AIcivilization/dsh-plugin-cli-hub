#!/usr/bin/env node
/* =========================================================================
 * scripts/show-quota.mjs —— 扫描本机所有 AI CLI 并显示额度状态
 *
 * 用法:  node scripts/show-quota.mjs
 *
 * 输出：
 *   1. 扫描发现的 CLI（包含路径/版本/认证状态）
 *   2. 每个 CLI 的额度（currency / used / total / 来源）
 * =======================================================================*/
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { spawn as cp_spawn } from 'node:child_process';

// 确保 ~/.local/bin / /usr/local/bin / /opt/homebrew/bin 在 PATH 上
const extraDirs = [
  `${process.env.HOME}/.local/bin`,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
];
const PATH = process.env.PATH ?? '';
const missing = extraDirs.filter(d => !PATH.includes(d));
if (missing.length > 0) process.env.PATH = [...missing, PATH].join(':');

const DIST = path.resolve(process.cwd(), 'dist/index.js');
if (!fs.existsSync(DIST)) {
  console.error('\x1b[31m[err] dist/index.js 不存在，请先运行 pnpm build\x1b[0m');
  process.exit(1);
}

const PKG = await import(DIST);
const { apply, name } = PKG;

// ============== 构造最小 Cordis Context ==============
const mem = {};
const ctx = {
  scope: 'show-quota',
  storage: {
    scoped: {
      async get(k) { return mem[k]; },
      async set(k, v) { mem[k] = v; },
    },
  },
  logger: (scope) => ({
    debug: () => {},
    info: () => {},
    warn: (...a) => console.error(`\x1b[33m[WARN ${scope}]\x1b[0m`, ...a),
    error: (...a) => console.error(`\x1b[31m[ERR ${scope}]\x1b[0m`, ...a),
  }),
  subprocess: {
    async exec(cmd, args, opts = {}) {
      return await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return; done = true;
          try { child.kill('SIGKILL'); } catch {}
          resolve({ stdout, stderr, exitCode: null });
        }, opts.timeout ?? 15_000);
        let stdout = '', stderr = '';
        let child;
        try { child = cp_spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env }); }
        catch (e) { clearTimeout(t); done = true; resolve({ stdout: '', stderr: e.message, exitCode: null }); return; }
        child.stdout?.on('data', d => stdout += d.toString('utf8'));
        child.stderr?.on('data', d => stderr += d.toString('utf8'));
        child.on('error', e => { if (done) return; done = true; clearTimeout(t); resolve({ stdout, stderr: e.message, exitCode: null }); });
        child.on('close', code => { if (done) return; done = true; clearTimeout(t); resolve({ stdout, stderr, exitCode: code }); });
      });
    },
  },
  tools: { define() { return { dispose() {} }; } },
  _eventHandlers: new Map(),
  on(event, handler) {
    let arr = this._eventHandlers.get(event);
    if (!arr) { arr = new Set(); this._eventHandlers.set(event, arr); }
    arr.add(handler);
    return () => this.off(event, handler);
  },
  off(event, handler) { this._eventHandlers.get(event)?.delete(handler); },
  emit(event, payload) { for (const h of this._eventHandlers.get(event) ?? []) { try { h(payload); } catch {} } },
  _props: {},
  set(key, value) { this._props[key] = value; },
  get(key) { return this._props[key]; },
  plugin: () => {},
};

// ============== 1. 装配插件 ==============
console.log(`\n\x1b[1m[1/3] 装配插件: ${name}\x1b[0m`);
try { await apply(ctx); } catch (e) { console.error('apply 失败:', e); process.exit(1); }
const cliHub = ctx.cliHub ?? ctx.get?.('cliHub');
if (!cliHub) { console.error('cliHub 未挂载'); process.exit(1); }
console.log('   ✓ 插件装配完成');

// ============== 2. 扫描本机 AI CLI ==============
console.log(`\n\x1b[1m[2/3] 扫描本机 AI CLI（L3 深度）\x1b[0m`);
const scanResult = await cliHub.scan({ depth: 'l3', timeoutPerCmd: 8000 });
const items = Array.isArray(scanResult) ? scanResult : (scanResult?.items ?? []);
const discovered = items.filter(i => i.adapterId);
console.log(`   扫描完成：共发现 \x1b[36m${discovered.length}\x1b[0m 个 AI CLI`);
if (discovered.length === 0) {
  console.log('\n   \x1b[33m未发现任何已注册的 AI CLI。检查 PATH：\x1b[0m');
  console.log('   ' + process.env.PATH.split(':').slice(0, 6).join(':') + '...');
  process.exit(0);
}

// ============== 3. 查询每个 CLI 的额度 ==============
console.log(`\n\x1b[1m[3/3] 查询额度状态\x1b[0m\n`);

const allAdapters = cliHub.registry.listAdapters();
const enabledIds = new Set(discovered.map(i => i.adapterId));
const targetIds = Array.from(enabledIds);

// 表格渲染
const COLS = [
  { key: 'adapterId', w: 16, label: 'Adapter' },
  { key: 'version',   w: 14, label: 'Version' },
  { key: 'auth',      w: 14, label: 'Auth' },
  { key: 'currency',  w: 9,  label: 'Currency' },
  { key: 'used',      w: 12, label: 'Used' },
  { key: 'total',     w: 12, label: 'Total' },
  { key: 'remaining', w: 12, label: 'Remaining' },
  { key: 'source',    w: 11, label: 'Source' },
  { key: 'period',    w: 10, label: 'Period' },
];

const rows = [];
for (const id of targetIds) {
  const item = discovered.find(i => i.adapterId === id);
  let quota;
  try { quota = await cliHub.quota.get(id, true); }
  catch (e) { quota = { source: 'error', currency: '-', used: '-', raw: { error: e?.message ?? String(e) } }; }
  rows.push({
    adapterId: id,
    version: item?.version ?? '-',
    auth: item?.authState ?? 'unknown',
    currency: quota?.currency ?? '-',
    used: quota?.used?.toLocaleString?.() ?? String(quota?.used ?? '-'),
    total: quota?.total?.toLocaleString?.() ?? (quota?.total === undefined ? '∞' : String(quota.total)),
    remaining: quota?.total
      ? ((quota.remaining ?? (quota.total - (quota.used ?? 0))).toLocaleString?.() ?? String(quota.remaining))
      : (quota?.source === 'estimate' ? '-' : '∞'),
    source: quota?.source ?? '-',
    period: quota?.period ?? '-',
  });
}

// 输出表格
const pad = (s, w) => String(s ?? '').padEnd(w, ' ').slice(0, w);
const header = COLS.map(c => pad(c.label, c.w)).join('  ');
const sep = COLS.map(c => '─'.repeat(c.w)).join('──');
console.log(`  ${header}`);
console.log(`  ${sep}`);
for (const r of rows) {
  const cells = COLS.map(c => pad(r[c.key] ?? '-', c.w)).join('  ');
  // 颜色：根据 source 区分
  const source = r.source;
  let prefix = '  ';
  if (source === 'provider') prefix = '\x1b[32m  '; // 绿
  else if (source === 'estimate') prefix = '\x1b[33m  '; // 黄
  else if (source === 'error') prefix = '\x1b[31m  '; // 红
  console.log(`${prefix}${cells}\x1b[0m`);
}

// 详情
console.log(`\n\x1b[1m详情：\x1b[0m\n`);
for (const r of rows) {
  const item = discovered.find(i => i.adapterId === r.adapterId);
  const adapterDef = allAdapters.find(a => a.id === r.adapterId);
  console.log(`\x1b[36m■ ${r.adapterId}\x1b[0m  ${adapterDef?.name ?? ''} (${adapterDef?.vendor ?? '?'})`);
  console.log(`   路径:    ${item?.executablePath ?? '-'}`);
  console.log(`   版本:    ${r.version}`);
  console.log(`   认证:    ${r.auth}`);
  console.log(`   额度来源: ${r.source}${r.source === 'estimate' ? '（provider 不支持查询，使用本地估算累计）' : ''}`);
  console.log(`   货币类型: ${r.currency}`);
  console.log(`   已使用:  ${r.used}${r.period !== '-' ? ` / 周期: ${r.period}` : ''}`);
  console.log(`   总额度:  ${r.total}`);
  console.log(`   剩余:    ${r.remaining}`);
  if (item?.authHint) console.log(`   提示:    ${item.authHint}`);
  console.log();
}
