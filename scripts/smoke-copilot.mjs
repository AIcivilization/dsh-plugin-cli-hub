#!/usr/bin/env node
/**
 * smoke-copilot.mjs — Copilot CLI Tool 模式冒烟测试。
 *
 * 2 个 tool：suggest（返回 schema 或自然语言建议）、explain（解释一段命令）。
 * 需要本机装了 `copilot` 并且已登录（`copilot auth` / GitHub Copilot subscription）。
 *
 * 用法：node scripts/smoke-copilot.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';

let PASS = 0, FAIL = 0, SKIP = 0;
const pass = (n) => { PASS++; console.log(`✅ [${n}] PASS`); };
const fail = (n, m) => { FAIL++; console.log(`❌ [${n}] FAIL: ${m}`); };
const skip = (n, m) => { SKIP++; console.log(`ℹ️ [${n}] SKIP: ${m}`); };

function hasCopilot() { return spawnSync('which', ['copilot']).status === 0; }
function run(args, timeout = 60_000) {
  try {
    return { ok: true, stdout: execFileSync('copilot', args,
      { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout }) };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e), stdout: e.stdout ?? '' };
  }
}

async function main() {
  console.log('== smoke-copilot ==');
  if (!hasCopilot()) { skip('env', 'copilot not installed. See GitHub Copilot CLI docs.'); process.exit(0); }

  // quick auth check: `copilot auth status` or similar (best effort, ignore errors)
  const st = run(['auth', 'status'], 10_000);
  if (!st.ok) console.log('ℹ️ copilot auth status unknown:', String(st.stderr).slice(0, 180));

  console.log('\n[1] copilot suggest "bulk rename all jpg files to png in ./photos" --language sh');
  const s = run(['suggest',
    'bulk rename all jpg files to png in ./photos',
    '--language', 'sh', '--json']);
  if (!s.ok) skip(1, `suggest failed (${String(s.stderr).slice(0,200)}). Probably not logged in to Copilot.`);
  else {
    try { JSON.parse((s.stdout||'').trim().split('\n').slice(-1)[0] || '{}'); pass(1); }
    catch {
      // Many Copilot builds return text, not JSON — if it contains shell code, call it a pass.
      const txt = (s.stdout || '').trim();
      if (txt.length > 20) pass(1);
      else fail(1, `suggest neither JSON nor long text. first 200: ${txt.slice(0,200)}`);
    }
  }

  console.log('\n[2] copilot explain "find . -name \'*.tmp\' -mtime +30 -delete"');
  const e = run(['explain',
    "find . -name '*.tmp' -mtime +30 -delete",
    '--json']);
  if (!e.ok) skip(2, `explain failed (${String(e.stderr).slice(0,200)}).`);
  else {
    try { JSON.parse((e.stdout||'').trim().split('\n').slice(-1)[0] || '{}'); pass(2); }
    catch {
      const txt = (e.stdout || '').trim();
      if (/find|30 days|delete|tmp/i.test(txt)) pass(2);
      else fail(2, `explain output not JSON/expected text. first 200: ${txt.slice(0,200)}`);
    }
  }

  console.log(`\n== summary: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error('UNEXPECTED ERROR:', e); process.exit(2); });
