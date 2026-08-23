/**
 * Claude Code Adapter
 *
 * Tool mode (V1 placeholder): invoke Claude Code as a "one-shot task-execution CLI tool":
 *   claude --max-turns 1 --no-confirm --task "..."   # equivalent to claude -y "..."
 * This approach reuses Claude's Anthropic subscription quota + MCP, but interaction is limited
 * in Tool mode, so the main capabilities live in Agent mode (M4 milestone).
 *
 * Agent mode (reserved, V2 implementation): stdio-jsonrpc mode
 *   claude --json --stdio
 */
import { defineCliAdapter } from '../define';

export const claudeCodeAdapter = defineCliAdapter({
  id: 'claude-code',
  name: 'Claude Code',
  description:
    'Anthropic official Claude Code CLI. Users with an Anthropic subscription can reuse their quota directly. Tool mode is one-shot task execution; full capabilities are in Agent mode (enabled when V2 supports stdio-jsonrpc).',
  icon: '🧠',
  vendor: 'Anthropic',
  officialDoc: 'https://docs.anthropic.com/en/docs/claude-code',
  installHint: 'npm i -g @anthropic-ai/claude-code, then claude auth login',
  defaultEnabled: true,

  fingerprint: {
    commandNames: ['claude', 'claude-code', 'claude-cli', 'claude-agent'],
    versionArgs: ['--version'],
    versionPattern: /(?:claude\s*code|claude)\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.anthropic', '~/Library/Application Support/Claude Code', '~/.claude'],
    envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_API_KEY'],
    authCheck: {
      cmd: 'claude auth status',
      // claude v2.1.x outputs JSON (multi-line), e.g.:
      //   { "loggedIn": true, "subscriptionType": "pro", ... }
      expectAuthenticated:
        /(^|\s|"|,)loggedIn["\s]*:[\s"]*true(,|\s|}|"|$)|"subscriptionType"[\s:]*"(pro|team)"/i,
      expectUnauthenticated:
        /(^|\s|"|,)loggedIn["\s]*:[\s"]*false(,|\s|}|"|$)|not logged|no.*key|unauthenticated|please.*(login|sign)/i,
    },
  },

  capabilities: {
    // === Tool mode: one-shot task execution (provided first in V1, simple but sufficient) ===
    tools: [
      {
        dshToolName: 'cli-hub:claude-code:run-task',
        description:
          'Execute a one-shot text task with the local Claude Code CLI and return the result (automatically reuses the logged-in Anthropic API Key/quota). Good for quick tasks like "have Claude write some code / analyze a piece of text / draft content". For long-running/multi-turn tasks, use Agent mode.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g., code snippets, file contents, notes)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory for execution (default = current DSH workspace)',
            },
            maxTurns: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
            timeoutSeconds: { type: 'integer', minimum: 10, maximum: 600, default: 180 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'resolver',
          resolver: (input, rtx) => {
            const merged = input.context ? `${input.context}\n\n---- TASK ----\n${input.task}` : input.task;
            // Claude Code v2.1.x actual CLI flags:
            //   -p                          non-interactive mode
            //   --output-format json        single JSON result (non-streaming)
            //   --add-dir <dir>             grant tool access to a directory
            //   --model auto                automatic model selection
            //   --permission-mode acceptEdits  auto-accept edits (avoids hanging on permission prompts)
            //   --                          prompt positional args follow
            // Note: --max-turns / --workspace / --no-confirm / --format no longer exist in v2.1.x
            const args = [
              '-p',
              '--output-format', 'json',
              '--add-dir', input.workdir ?? rtx.workspace,
              '--model', 'auto',
              '--permission-mode', 'acceptEdits',
              '--',
              merged,
            ];
            return {
              cmd: 'claude',
              args,
              cwd: input.workdir ?? rtx.workspace,
            };
          },
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, stderr, code) => {
            // Claude --format json outputs JSON; tolerate failure cases
            const jsonPart = stdout.match(/\{[\s\S]*\}/)?.[0];
            if (jsonPart) {
              try { return JSON.parse(jsonPart); } catch { /* fallthrough */ }
            }
            if (code !== 0 && !stdout.trim()) throw new Error(stderr || `claude exit ${code}`);
            return { status: code === 0 ? 'ok' : 'warn', text: stdout.trim() || stderr.trim() };
          },
        },
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],

    // === Agent mode V2: full stream-json stdio (Claude Code's actual protocol) ===
    // Claude Code v2.1.x stream-json protocol:
    //   Input: one JSON event per line, e.g.
    //     {"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
    //   Output: one JSON event per line, in order:
    //     1) {"type":"system","subtype":"hook_started",...}     (SessionStart hook, emitted right after spawn)
    //     2) {"type":"system","subtype":"hook_response",...}    (hook result)
    //     3) {"type":"system","subtype":"init","cwd":...,"tools":[...],...}  (session initialization complete)
    //     4) {"type":"assistant","message":{...content:[{type:"text","text":"..."}]...}}
    //     5) {"type":"result","is_error":false,"result":"...","usage":{...}}  (final result)
    // Full docs: https://docs.claude.com/en/docs/claude-code/sdk/streaming
    //
    // Note: subtype=init is only emitted after the first user input arrives. But AgentGateway
    // semantics are "wait for ready before send", which would deadlock. So readyPattern uses hook_started
    // (triggered right after spawn) so send can start as early as possible; subsequent hook_response / init
    // events are still exposed to the caller via recv().
    agent: {
      protocol: 'stream-json',
      spawn: {
        command: 'claude',
        // Claude Code has no native --workspace flag; set the working directory via spawn cwd,
        // and grant tool access via --add-dir (CLAUDE.md auto-discovery is also based on this directory).
        argsTemplate: [
          '-p',                              // print mode (non-interactive)
          '--output-format', 'stream-json',  // streaming JSON output
          '--input-format', 'stream-json',   // streaming JSON input
          '--verbose',                       // full event stream
          '--add-dir', '{{workspace}}',      // grant access to the working directory
        ],
        // ready signal: subtype=hook_started is the first event claude emits right after spawn
        readyPattern: '"subtype":"hook_started"',
        readyTimeoutMs: 30_000,              // first startup may need to load hooks/MCP; allow enough time
        gracefulShutdownSignal: 'SIGINT',
        shutdownGraceMs: 3000,
      },
      agentMeta: {
        displayName: 'Claude Code',
        description: 'Anthropic official Agent, strong at code/reasoning. Shares MCP tools and credentials already configured in DSH.',
        avatarEmoji: '🧠',
        strengths: ['Code', 'Reasoning', 'Writing'],
        supportsStreaming: true,
      },
      shareDshTools: true,
    },
  },

  quota: {
    method: {
      kind: 'unknown',  // Claude Code has no "quota" subcommand; rely on local estimation
    },
    estimatePerAgentTurn: (inTk, outTk) => {
      // Claude 3.5 Sonnet rough estimate: in $3/M, out $15/M → ~$5/1M tokens overall, 1:1 credit
      return Math.round((inTk + outTk) / 100);  // every 100 tokens ~= 1 credit
    },
  },

  minimumVersion: '0.12.0',
});
