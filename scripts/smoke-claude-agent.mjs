#!/usr/bin/env node
/**
 * Real-environment smoke test for Claude Code Agent mode.
 * 直接通过 AgentGateway 启动真实 claude 进程，验证：
 *   1) spawn 成功（subprocess 起来）
 *   2) ready 检测命中（subtype=init 事件）
 *   3) send 一条 user 消息
 *   4) recv 拿到 assistant 消息（带 text）
 *   5) shutdown 三阶段优雅关闭
 *
 * 调用：node scripts/smoke-claude-agent.mjs
 * 退出码：0 全通过；非 0 = 失败步骤
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 bundle 产物（CJS）—— 真实复现 DSH 运行时
const distCjs = path.join(__dirname, '..', 'dist', 'index.cjs');
const mod = require(distCjs);

// 加载内置 adapter（bundle 后通过 mod.BUILTIN_ADAPTERS 暴露）
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

// 构造一个最小 registry
const registry = {
  get: (id) => id === 'claude-code' ? claudeAdapter : undefined,
  isEnabled: (id) => id === 'claude-code',
};

// 构造最小 ctx：只提供 baseDir，subprocess 缺失以走 node child_process fallback
const ctx = {
  baseDir: process.cwd(),
  // 故意不提供 ctx.subprocess，强制走 fallback，确保单测外也能跑
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
  // stream-json 输入：{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  log('Step 2: sending user message "say: pong (only the word)"...');
  const userMsg = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Reply with exactly: pong' }],
    },
  };
  await session.send(userMsg);

  // ===== Step 3: recv loop —— 收集 assistant 事件，最长等 60s =====
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
