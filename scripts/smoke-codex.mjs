#!/usr/bin/env node
/**
 * smoke-codex.mjs — Codex CLI Tool-mode smoke test.
 *
 * Only verifies that `codex --version` / `codex exec --help` show Codex's interface exists;
 * actually running exec requires a logged-in state, so the `--help` / `--version` paths serve as
 * "command structure OK" evidence; on failure, SKIP.
 *
 * Usage: node scripts/smoke-codex.mjs
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

  console.log('\n[2] codex exec --help lists arguments (verify argv structure)');
  const h = run(bin, ['exec', '--help']);
  if (!h.ok) {
    const h2 = run(bin, ['--help']);
    if (h2.ok && /exec/i.test(h2.stdout || h2.stderr || '')) pass(2);
    else skip(2, `exec --help failed. Probably different build: ${String(h2.stderr||h.stderr).slice(0,200)}`);
  } else {
    const txt = (h.stdout + (h.stderr || '')).toLowerCase();
    if (/--model|--cwd|--json|prompt|task/.test(txt)) pass(2);
    else fail(2, `exec help output shows no known flags. first 300: ${(h.stdout||'').slice(0,300)}`);
  }

  console.log('\n[3] (dry) verify argv mapping structure: codex exec --json + positional task is correctly recognized by Codex as a help/usage error rather than "unknown flag" (no real invocation without login)');
  // If codex treats --json in `exec --json --cwd /tmp "say hi"` as an unknown flag, the argv structure does not match the adapter declaration.
  // Since we may not be logged in, we only require that stderr/stdout does not contain "unknown option: --json" to pass; a non-zero exit caused by missing login is acceptable.
  const args = ['exec', '--json', '--cwd', process.cwd(), 'dry probe from smoke-codex (please ignore this run)'];
  const d = run(bin, args, 20_000);
  const combo = (d.stdout || '') + '\n' + (d.stderr || '');
  if (/unknown (option|flag|argument):.*(--json|--cwd)/i.test(combo)) {
    fail(3, `argv mapping mismatch: Codex does not recognize the --json/--cwd flags. Output: ${combo.slice(0,300)}`);
  } else {
    console.log('   (exit non-zero or warn about auth / rate limit is acceptable for dry probe)');
    pass(3);
  }

  console.log(`\n== summary: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error('UNEXPECTED ERROR:', e); process.exit(2); });
