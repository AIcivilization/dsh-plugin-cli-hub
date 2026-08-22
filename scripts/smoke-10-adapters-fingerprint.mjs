#!/usr/bin/env node
/**
 * smoke-10-adapters-fingerprint.mjs
 *
 * 不依赖登录态、不真发起付费调用：
 *   · 构造默认 Registry，加载 33 个 BUILTIN_ADAPTERS
 *   · 对 10 个主流 adapter（id 硬编码在下面）做 Scanner L1/L2 探测
 *   · L1 通过：系统里能找到至少一个 commandNames 可执行文件
 *   · L2 通过：`--version` 能输出版本字符串并匹配 fingerprint.versionPattern
 *   · L3 authCheck：只跑命令，不根据通过/失败计数（要登录）。
 *
 * 单台 Mac 通常能命中 7~20 个，这个脚本只关心 L1/L2 的 fingerprint 写得对不对。
 *
 * 用法：node scripts/smoke-10-adapters-fingerprint.mjs [--all]
 *       --all：检测全部 33 个 adapter，而不是只测 10 个主流的
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distCjs = path.join(__dirname, '..', 'dist', 'index.cjs');
const mod = require(distCjs);

const ALL = (mod.BUILTIN_ADAPTERS || []);

const MAINSTREAM_10 = [
  'claude-code',
  'codex',
  'copilot',
  'snow-cli',
  'kimi-cli',
  'gemini-cli',
  'ollama',
  'litellm',
  'officecli',
  'windsurf',
];

const targets = process.argv.includes('--all')
  ? ALL.map(a => a.id)
  : MAINSTREAM_10;

let L1 = 0, L2 = 0, SKIP = 0, ERR = 0;

function which(bin) {
  try {
    execFileSync('which', [bin], { stdio: ['ignore','pipe','ignore'] });
    return true;
  } catch { return false; }
}

console.log('== smoke-10-adapters-fingerprint', targets.length === ALL.length ? '(ALL 33)' : `(${targets.length} mainstream)`, '==');

for (const id of targets) {
  const a = ALL.find(x => x.id === id);
  if (!a) { ERR++; console.log(`❌ ${id}: adapter not in BUILTIN_ADAPTERS`); continue; }
  const bins = a.fingerprint?.commandNames || [];
  const foundBin = bins.find(b => which(b));

  if (!foundBin) {
    SKIP++;
    console.log(`ℹ️  ${id}: NOT INSTALLED (tried ${bins.join(', ')}) → L1 SKIP`);
    continue;
  }
  L1++;
  const print = (label, ok, note = '') => {
    const icon = ok ? '✅' : '⚠️';
    console.log(`${icon}  ${id}: ${label} (bin=${foundBin})${note ? ' — ' + note : ''}`);
  };

  // L2: version extraction
  const vArgs = a.fingerprint.versionArgs || ['--version'];
  let l2Ok = false;
  try {
    const stdout = execFileSync(foundBin, vArgs, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 5000 });
    const m = stdout.match(a.fingerprint.versionPattern || /v?(\d[\w.+-]*)/);
    if (m) { print('L2', true, `version=${m[0]}`); l2Ok = true; L2++; }
    else {
      // No versionPattern or no match — try a looser regex to see if there's any version-like string at all
      const any = stdout.match(/\b\d+\.\d+[\w.+-]*/);
      print('L2', false, `pattern miss. stdout first 120: "${(stdout||'').trim().slice(0,120)}"${any ? ` (loose=${any[0]})` : ''}`);
    }
  } catch (e) {
    print('L2', false, `cmd err: ${String(e?.stderr ?? e).slice(0,180)}`);
  }

  // L3: auth check — best effort, only print output (no counting)
  if (a.fingerprint.authCheck?.cmd) {
    try {
      const [cmd, ...rest] = a.fingerprint.authCheck.cmd.split(/\s+/);
      const bin = which(cmd) ? cmd : foundBin;  // kimi auth status → cmd=kimi
      const out = spawnSync(bin, rest, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 8000 });
      const combo = (out.stdout||'') + '\n' + (out.stderr||'');
      const authOk = a.fingerprint.authCheck.expectAuthenticated?.test?.(combo);
      const authNo = a.fingerprint.authCheck.expectUnauthenticated?.test?.(combo);
      const authEx = a.fingerprint.authCheck.expectExpired?.test?.(combo);
      console.log(`      auth check → ${authOk ? 'AUTH' : authNo ? 'NOAUTH' : authEx ? 'EXPIRED' : 'UNKNOWN'}`
        + ` (cmd=${bin} ${rest.join(' ')})`);
    } catch (e) {
      console.log(`      auth check → err: ${String(e).slice(0,120)}`);
    }
  }

  // unused variable
  void l2Ok;
}

console.log(`\n== summary: targets=${targets.length} L1-found=${L1} L2-match=${L2} not-installed=${SKIP} errors=${ERR} ==`);
process.exit(ERR > 0 ? 1 : 0);
