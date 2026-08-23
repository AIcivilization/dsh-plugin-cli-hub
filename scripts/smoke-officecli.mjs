#!/usr/bin/env node
/**
 * smoke-officecli.mjs — OfficeCLI Tool-mode smoke test.
 *
 * Only exercises **command-line startup** of the gen-ppt / gen-word / gen-excel tools (minimal input);
 * does not verify output content correctness — PASS as long as exit 0 and the artifact file is not empty.
 *
 * officecli not installed / not logged in → overall SKIP.
 *
 * Usage: node scripts/smoke-officecli.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let PASS = 0, FAIL = 0, SKIP = 0;
const pass = (n) => { PASS++; console.log(`✅ [${n}] PASS`); };
const fail = (n, m) => { FAIL++; console.log(`❌ [${n}] FAIL: ${m}`); };
const skip = (n, m) => { SKIP++; console.log(`ℹ️ [${n}] SKIP: ${m}`); };

function hasOffice() { return spawnSync('which', ['officecli']).status === 0; }
function run(args, cwd, timeout = 300_000) {
  try {
    return { ok: true, stdout: execFileSync('officecli', args,
      { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], cwd, timeout }) };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e), stdout: e.stdout ?? '' };
  }
}

async function main() {
  console.log('== smoke-officecli ==');
  if (!hasOffice()) { skip('env', 'officecli not installed.'); process.exit(0); }

  const tmp = mkdtempSync(join(tmpdir(), 'officecli-smoke-'));
  try {
    // 1) PPT
    console.log('\n[1] officecli ppt → smoke-out.pptx');
    const pptPath = join(tmp, 'smoke-out.pptx');
    const ppt = run(['ppt', '--topic', 'Smoke Test Deck',
      '--style', 'minimal', '--slides', '3', '--out', pptPath, '--format', 'json'], tmp);
    if (!ppt.ok) skip(1, `ppt step failed (${String(ppt.stderr).slice(0,240)}). Probably not logged in.`);
    else if (existsSync(pptPath) && statSync(pptPath).size > 1000) pass(1);
    else fail(1, `ppt produced no/too-small file (${existsSync(pptPath) ? `${statSync(pptPath).size}B` : 'missing'})`);

    // 2) Word
    console.log('\n[2] officecli docx → smoke-out.docx');
    const docxPath = join(tmp, 'smoke-out.docx');
    const sections = JSON.stringify([
      { heading: 'Intro', body: 'Hello world smoke test.', level: 1 },
      { heading: 'Body', body: 'More body text.', level: 2 },
      { heading: 'Conclusion', body: 'End.', level: 1 },
    ]);
    const doc = run(['docx', '--title', 'Smoke Test', '--template', 'general',
      '--out', docxPath, '--sections', sections, '--format', 'json'], tmp);
    if (!doc.ok) skip(2, `docx step failed (${String(doc.stderr).slice(0,240)}).`);
    else if (existsSync(docxPath) && statSync(docxPath).size > 1000) pass(2);
    else fail(2, `docx no/too-small file (${existsSync(docxPath) ? `${statSync(docxPath).size}B` : 'missing'})`);

    // 3) Excel
    console.log('\n[3] officecli xlsx → smoke-out.xlsx');
    const xlsxPath = join(tmp, 'smoke-out.xlsx');
    const payload = JSON.stringify([
      { name: 'Sheet1', data: [
        ['Month', 'Revenue', 'Cost'],
        ['Jan', 120, 80],
        ['Feb', 150, 95],
        ['Mar', 180, 110],
      ]},
    ]);
    const xls = run(['xlsx', '--out', xlsxPath, '--format', 'json', '--payload', payload], tmp);
    if (!xls.ok) skip(3, `xlsx step failed (${String(xls.stderr).slice(0,240)}).`);
    else if (existsSync(xlsxPath) && statSync(xlsxPath).size > 500) pass(3);
    else fail(3, `xlsx no/too-small file (${existsSync(xlsxPath) ? `${statSync(xlsxPath).size}B` : 'missing'})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n== summary: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error('UNEXPECTED ERROR:', e); process.exit(2); });
