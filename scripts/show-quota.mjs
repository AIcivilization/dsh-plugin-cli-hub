#!/usr/bin/env node
/* =========================================================================
 * scripts/show-quota.mjs — Scan all AI CLIs on this machine and display quota status
 *
 * Usage:  node scripts/show-quota.mjs
 *
 * Output:
 *   1. CLIs discovered by the scan (including path/version/auth status)
 *   2. Each CLI's quota (currency / used / total / source)
 * =======================================================================*/
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { spawn as cp_spawn } from 'node:child_process';

// Ensure ~/.local/bin / /usr/local/bin / /opt/homebrew/bin are on PATH
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
  console.error('\x1b[31m[err] dist/index.js does not exist; run pnpm build first\x1b[0m');
  process.exit(1);
}

const PKG = await import(DIST);
const { apply, name } = PKG;

// ============== Build a minimal Cordis Context ==============
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

// ============== 1. Load the plugin ==============
console.log(`\n\x1b[1m[1/3] Loading plugin: ${name}\x1b[0m`);
try { await apply(ctx); } catch (e) { console.error('apply failed:', e); process.exit(1); }
const cliHub = ctx.cliHub ?? ctx.get?.('cliHub');
if (!cliHub) { console.error('cliHub not mounted'); process.exit(1); }
console.log('   ✓ plugin loaded');

// ============== 2. Scan local AI CLIs ==============
console.log(`\n\x1b[1m[2/3] Scanning local AI CLIs (L3 deep)\x1b[0m`);
const scanResult = await cliHub.scan({ depth: 'l3', timeoutPerCmd: 8000 });
const items = Array.isArray(scanResult) ? scanResult : (scanResult?.items ?? []);
const discovered = items.filter(i => i.adapterId);
console.log(`   Scan complete: found \x1b[36m${discovered.length}\x1b[0m AI CLIs`);
if (discovered.length === 0) {
  console.log('\n   \x1b[33mNo registered AI CLIs found. Check PATH:\x1b[0m');
  console.log('   ' + process.env.PATH.split(':').slice(0, 6).join(':') + '...');
  process.exit(0);
}

// ============== 3. Query each CLI's quota ==============
console.log(`\n\x1b[1m[3/3] Querying quota status\x1b[0m\n`);

const allAdapters = cliHub.registry.listAdapters();
const enabledIds = new Set(discovered.map(i => i.adapterId));
const targetIds = Array.from(enabledIds);

// Table rendering
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

// Print the table
const pad = (s, w) => String(s ?? '').padEnd(w, ' ').slice(0, w);
const header = COLS.map(c => pad(c.label, c.w)).join('  ');
const sep = COLS.map(c => '─'.repeat(c.w)).join('──');
console.log(`  ${header}`);
console.log(`  ${sep}`);
for (const r of rows) {
  const cells = COLS.map(c => pad(r[c.key] ?? '-', c.w)).join('  ');
  // Color: differentiate by source
  const source = r.source;
  let prefix = '  ';
  if (source === 'provider') prefix = '\x1b[32m  '; // green
  else if (source === 'estimate') prefix = '\x1b[33m  '; // yellow
  else if (source === 'error') prefix = '\x1b[31m  '; // red
  console.log(`${prefix}${cells}\x1b[0m`);
}

// Details
console.log(`\n\x1b[1mDetails:\x1b[0m\n`);
for (const r of rows) {
  const item = discovered.find(i => i.adapterId === r.adapterId);
  const adapterDef = allAdapters.find(a => a.id === r.adapterId);
  console.log(`\x1b[36m■ ${r.adapterId}\x1b[0m  ${adapterDef?.name ?? ''} (${adapterDef?.vendor ?? '?'})`);
  console.log(`   Path:         ${item?.executablePath ?? '-'}`);
  console.log(`   Version:      ${r.version}`);
  console.log(`   Auth:         ${r.auth}`);
  console.log(`   Quota source: ${r.source}${r.source === 'estimate' ? ' (provider does not support queries; using local estimated totals)' : ''}`);
  console.log(`   Currency:     ${r.currency}`);
  console.log(`   Used:         ${r.used}${r.period !== '-' ? ` / period: ${r.period}` : ''}`);
  console.log(`   Total:        ${r.total}`);
  console.log(`   Remaining:    ${r.remaining}`);
  if (item?.authHint) console.log(`   Hint:         ${item.authHint}`);
  console.log();
}
