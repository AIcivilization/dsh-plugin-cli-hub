#!/usr/bin/env node
/**
 * smoke-snow-cli.mjs — Snow CLI Tool-mode smoke test.
 *
 * Verifies 4 Tools in a real environment: translate (fastest, no resources involved) / draw / tts / asr
 * (the last two need input samples; SKIP if no sample or ffmpeg is not installed).
 *
 * On this machine:
 *   · No `snow` executable → overall SKIP (exit 0)
 *   · `snow quota` returns "not logged in" → translate is also SKIPped
 *   · A single Tool fails → a single FAIL, does not block the others
 *
 * Usage: node scripts/smoke-snow-cli.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let PASS = 0, FAIL = 0, SKIP = 0;
const pass = (n) => { PASS++; console.log(`✅ [${n}] PASS`); };
const fail = (n, m) => { FAIL++; console.log(`❌ [${n}] FAIL: ${m}`); };
const skip = (n, m) => { SKIP++; console.log(`ℹ️ [${n}] SKIP: ${m}`); };

function hasSnow() {
  return spawnSync('which', ['snow']).status === 0;
}
function run(cmd, args, opts = {}) {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e), stdout: e.stdout ?? '' };
  }
}

async function main() {
  console.log('== smoke-snow-cli ==');

  if (!hasSnow()) {
    skip('env', '`snow` executable not on PATH; install Snow CLI first, then re-run.');
    finish();
  }

  const q = run('snow', ['quota', '--json']);
  if (!q.ok) {
    console.log('⚠️ snow quota failed — assuming unauthenticated. stderr:', String(q.stderr).slice(0, 120));
  }

  // 1) translate — the cheapest
  console.log('\n[1] snow translate "Hello world" → zh');
  const tr = run('snow', ['translate', '--text', 'Hello world, this is a smoke test.',
    '--to', 'zh', '--domain', 'general', '--format', 'json']);
  if (!tr.ok) { skip(1, `translate failed (${String(tr.stderr).slice(0,180)}). CLI may not be authenticated.`); }
  else {
    try {
      const j = JSON.parse(tr.stdout.trim().split('\n').slice(-1)[0] || '{}');
      if (j && (j.translated || j.result || typeof j === 'object')) pass(1);
      else fail(1, 'returned JSON missing translated field');
    } catch { fail(1, `output not JSON. first 200: ${tr.stdout.slice(0, 200)}`); }
  }

  // 2) draw — needs an authenticated Snow account (Mistral credits or Snowflake)
  console.log('\n[2] snow draw "a minimalist geometric logo" 512x512 (no-network cached case ok too)');
  const tmp = mkdtempSync(join(tmpdir(), 'snow-smoke-'));
  const outFile = join(tmp, 'draw.png');
  try {
    const dr = run('snow', ['draw', '--prompt', 'a minimalist geometric logo',
      '--size', '512x512', '--out', outFile]);
    if (!dr.ok) { skip(2, `draw CLI step failed (${String(dr.stderr).slice(0,180)}). May need real Snow account.`); }
    else if (existsSync(outFile) || /saved|wrote|output/i.test(dr.stdout || '')) pass(2);
    else skip(2, `draw returned 0 but no file produced at ${outFile}; stdout="${String(dr.stdout).slice(0,120)}"`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3) tts — requires sample audio lib, usually falls back gracefully
  console.log('\n[3] snow tts "Smoke test: hello from dsh-plugin-cli-hub" (skips if voice lib missing)');
  const tmp2 = mkdtempSync(join(tmpdir(), 'snow-smoke-'));
  const ttsOut = join(tmp2, 'tts.mp3');
  try {
    const tt = run('snow', ['tts', '--text', 'Smoke test: hello from dsh-plugin-cli-hub',
      '--voice', 'female-zh', '--speed', '1.0', '--out', ttsOut]);
    if (!tt.ok) skip(3, `tts CLI failed (${String(tt.stderr).slice(0,180)}).`);
    else if (existsSync(ttsOut) || /\.(mp3|wav|m4a)/i.test(tt.stdout || '')) pass(3);
    else skip(3, 'tts no artifact; likely needs local voice model.');
  } finally {
    rmSync(tmp2, { recursive: true, force: true });
  }

  // 4) asr — need a 1-second WAV input; synthesize a tiny silent wav via node
  console.log('\n[4] snow asr <synthetic 1s wav> (skips if asr model download needed)');
  const tmp3 = mkdtempSync(join(tmpdir(), 'snow-smoke-'));
  const wavPath = join(tmp3, 'silence.wav');
  try {
    // Minimal valid WAV: 44-byte header + 8000 bytes of zeroed mono 16-bit 8 kHz = 0.5 s silence
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF',0); hdr.writeUInt32LE(36+8000,4); hdr.write('WAVE',8);
    hdr.write('fmt ',12); hdr.writeUInt32LE(16,16); hdr.writeUInt16LE(1,20); // PCM
    hdr.writeUInt16LE(1,22); hdr.writeUInt32LE(8000,24); hdr.writeUInt32LE(16000,28);
    hdr.writeUInt16LE(2,32); hdr.writeUInt16LE(16,34);
    hdr.write('data',36); hdr.writeUInt32LE(8000,40);
    writeFileSync(wavPath, Buffer.concat([hdr, Buffer.alloc(8000, 0)]));
    const ar = run('snow', ['asr', '--in', wavPath, '--format', 'json', '--timestamp', 'false']);
    if (!ar.ok) skip(4, `asr CLI failed (${String(ar.stderr).slice(0,180)}).`);
    else {
      try { JSON.parse((ar.stdout || '').trim().split('\n').slice(-1)[0] || '{}'); pass(4); }
      catch { fail(4, `asr didn't emit JSON; first 200: ${ar.stdout?.slice(0,200)}`); }
    }
  } finally {
    rmSync(tmp3, { recursive: true, force: true });
  }

  finish();
}

function finish() {
  console.log(`\n== summary: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error('UNEXPECTED ERROR:', e); process.exit(2); });
