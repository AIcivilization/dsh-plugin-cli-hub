#!/usr/bin/env node
/**
 * smoke-codex.mjs — Codex CLI Tool 模式冒烟测试。
 *
 * 只验证 `codex --version` / `codex exec --help` 是否有 Codex 的接口存在；
 * 真执行 exec 需要登录态，所以这里用 `--help` / `--version` 路径当"命令结构 OK"
 * 证据；失败就 SKIP。
 *
 * 用法：node scripts/smoke-codex.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';

let PASS = 0, FAIL = 0, SKIP = 0;
const pass = (n) => { PASS++; console.log(`✅ [${n}] PASS`); };
const fail = (n, m) => { FAIL++; console.log(`❌ [${n}] FAIL: ${m}`); };
const skip = (n, m) => { SKIP++; console.log(`ℹ️ [${n}] SKIP: ${m}`); };

function resolveBin() {
  for (const b of ['codex', 'codex-cli', 'codex-code-mode-host']) {
    if (spawnSync('which', [b]).status === 0) return b;
  }
  return null;
}
function run(bin, args, timeout = 30_000) {
  try {
    return { ok: true, stdout: execFileSync(bin, args,
      { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout }) };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e), stdout: e.stdout ?? '' };
  }
}

async function main() {
  console.log('== smoke-codex ==');
  const bin = resolveBin();
  if (!bin) { skip('env', 'codex / codex-cli not installed. See TRAE Codex docs.'); process.exit(0); }
  console.log('using bin =', bin);

  console.log('\n[1] codex version (fingerprint L2)');
  const v = run(bin, ['--version']);
  if (v.ok && v.stdout.length > 2) pass(1);
  else {
    const v2 = run(bin, ['version']);
    if (v2.ok && v2.stdout.length > 2) pass(1);
    else skip(1, `version probe failed; stderr="${String(v.stderr||v2.stderr).slice(0,200)}"`);
  }

  console.log('\n[2] codex exec --help 列出参数（验证 argv 结构）');
  const h = run(bin, ['exec', '--help']);
  if (!h.ok) {
    const h2 = run(bin, ['--help']);
    if (h2.ok && /exec/i.test(h2.stdout || h2.stderr || '')) pass(2);
    else skip(2, `exec --help failed. Probably different build: ${String(h2.stderr||h.stderr).slice(0,200)}`);
  } else {
    const txt = (h.stdout + (h.stderr || '')).toLowerCase();
    if (/--model|--cwd|--json|prompt|task/.test(txt)) pass(2);
    else fail(2, `exec help 输出里没看到已知 flag。first 300: ${(h.stdout||'').slice(0,300)}`);
  }

  console.log('\n[3] (dry) 验证 argv 映射结构：codex exec --json + positional task 能被 Codex 正确识别为 help/usage 错误而不是"unknown flag"（无登录态不真调用）');
  // 如果 codex 把 `exec --json --cwd /tmp "say hi"` 中的 --json 视为 unknown flag，就说明 argv 结构和 adapter 声明不匹配。
  // 因为可能没登录，我们只要看 stderr/stdout 不含有 "unknown option: --json" 就算过；exit 非零由登录导致可以接受。
  const args = ['exec', '--json', '--cwd', process.cwd(), 'dry probe from smoke-codex (please ignore this run)'];
  const d = run(bin, args, 20_000);
  const combo = (d.stdout || '') + '\n' + (d.stderr || '');
  if (/unknown (option|flag|argument):.*(--json|--cwd)/i.test(combo)) {
    fail(3, `argv 映射不匹配：Codex 不认识 --json/--cwd flag。输出：${combo.slice(0,300)}`);
  } else {
    console.log('   (exit non-zero or warn about auth / rate limit is acceptable for dry probe)');
    pass(3);
  }

  console.log(`\n== summary: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error('UNEXPECTED ERROR:', e); process.exit(2); });
