#!/usr/bin/env node
/**
 * Real-environment smoke test for Claude Code Agent mode.
 * Launches a real claude process directly via AgentGateway to verify:
 *   1) spawn succeeds (subprocess comes up)
 *   2) ready detection hits (subtype=init event)
 *   3) send a user message
 *   4) recv gets an assistant message (with text)
 *   5) shutdown gracefully closes in three phases
 *
 * Usage: node scripts/smoke-claude-agent.mjs
 * Exit code: 0 = all passed; non-zero = failed step
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the bundle artifact (CJS) — faithfully reproduces the DSH runtime
const distCjs = path.join(__dirname, '..', 'dist', 'index.cjs');
const mod = require(distCjs);

// Load built-in adapters (exposed via mod.BUILTIN_ADAPTERS after bundling)
const adapters = mod.BUILTIN_ADAPTERS || [];
const claudeAdapter = adapters.find(a => a.id === 'claude-code');
if (!claudeAdapter) {
  console.error('FAIL: claude-code adapter not found; available:', adapters.map(a => a.id));
  process.exit(1);
}

console.log('=== adapter loaded ===');
console.log('  id          =', claudeAdapter.id);
console.log('  agent proto =', claudeAdapter.capabilities.agent.protocol);
console.log('  spawn cmd   =', claudeAdapter.capabilities.agent.spawn.command);
console.log('  spawn args  =', JSON.stringify(claudeAdapter.capabilities.agent.spawn.argsTemplate));
console.log('  readyPat    =', claudeAdapter.capabilities.agent.spawn.readyPattern);

// Build a minimal registry
const registry = {
  get: (id) => id === 'claude-code' ? claudeAdapter : undefined,
  isEnabled: (id) => id === 'claude-code',
};

// Build a minimal ctx: only provide baseDir; omit subprocess so the node child_process fallback is used
const ctx = {
  baseDir: process.cwd(),
  // Deliberately omit ctx.subprocess to force the fallback, ensuring it also runs outside unit tests
};

const agentGateway = mod.createAgentGateway(ctx, registry, {
  defaultReadyTimeoutMs: 30_000,
  defaultShutdownGraceMs: 3_000,
  singletonPerAdapter: true,
});

const log = (...a) => console.log('[smoke]', ...a);

async function main() {
  // ===== Step 1: spawn =====
  log('Step 1: spawning claude-code agent session...');
  const session = await agentGateway.spawn('claude-code', { reuse: false });
  log('  sessionId =', session.sessionId);
  log('  pid       =', session.pid ?? '(n/a)');
  log('  protocol  =', session.protocol);
  log('  status    =', session.status);
  log('  readyAt   =', session.readyAt);

  if (session.status !== 'ready') {
    log('FAIL: session not ready; status =', session.status);
    await agentGateway.stop('claude-code').catch(() => {});
    process.exit(2);
  }

  // ===== Step 2: send a user message =====
  // stream-json input: {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  log('Step 2: sending user message "say: pong (only the word)"...');
  const userMsg = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Reply with exactly: pong' }],
    },
  };
  await session.send(userMsg);

  // ===== Step 3: recv loop — collect assistant events, wait up to 60s =====
  log('Step 3: receiving stream-json events (timeout 60s)...');
  const startTime = Date.now();
  const events = [];
  let assistantText = '';
  let resultEvent = null;
  const deadline = startTime + 60_000;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    let ev;
    try {
      ev = await session.recv(remaining);
    } catch (e) {
      log('  recv error:', e.message);
      break;
    }
    events.push(ev);
    log(`  [${events.length}] type=${ev?.type ?? '?'} subtype=${ev?.subtype ?? '-'}`);

    if (ev?.type === 'assistant' && ev?.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === 'text' && c.text) {
          assistantText += c.text;
          log(`    assistant text chunk: ${JSON.stringify(c.text).slice(0, 120)}`);
        }
      }
    }
    if (ev?.type === 'result') {
      resultEvent = ev;
      log(`    result: is_error=${ev.is_error} result=${JSON.stringify(ev.result ?? '').slice(0, 80)}`);
      break;
    }
  }

  log('Step 3 done. total events =', events.length);
  log('  assistantText =', JSON.stringify(assistantText));
  log('  resultEvent   =', resultEvent ? `is_error=${resultEvent.is_error}, result=${JSON.stringify(resultEvent.result)}` : '(none)');

  const replyOk = /pong/i.test(assistantText) || /pong/i.test(String(resultEvent?.result ?? ''));

  // ===== Step 4: shutdown =====
  log('Step 4: graceful shutdown...');
  const shutdownStart = Date.now();
  await agentGateway.stop('claude-code');
  log(`  shutdown done in ${Date.now() - shutdownStart}ms; final status = ${session.status}`);

  // ===== verdict =====
  log('');
  log('=== verdict ===');
  log('  spawn      : PASS');
  log('  ready      : PASS (subtype=init detected)');
  log('  send       : PASS');
  log('  recv       :', events.length > 0 ? `PASS (${events.length} events)` : 'FAIL (no events)');
  log('  reply text :', replyOk ? `PASS ("${assistantText.slice(0, 40)}")` : `FAIL (no "pong" in reply)`);
  log('  shutdown   : PASS');

  if (!replyOk) {
    log('');
    log('FAIL: did not receive expected "pong" reply');
    process.exit(3);
  }
  log('');
  log('ALL PASSED ✅');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('smoke-claude-agent crashed:', e?.stack || e);
  try { await agentGateway.stop('claude-code'); } catch {}
  process.exit(99);
});
