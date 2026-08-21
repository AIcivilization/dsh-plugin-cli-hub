/**
 * Claude Code Adapter
 *
 * Tool 模式（V1 占位）：把 Claude Code 当"一次性执行任务的命令行工具"来调：
 *   claude --max-turns 1 --no-confirm --task "..."   # 等价于 claude -y "..."
 * 这种方式能复用 Claude 的 Anthropic 订阅额度 + MCP，但在 Tool 模式里交互受限，
 * 因此主要能力在 Agent 模式（M4 里程碑）。
 *
 * Agent 模式（预留，V2 实现）：stdio-jsonrpc 模式
 *   claude --json --stdio
 */
import { defineCliAdapter } from '../define';

export const claudeCodeAdapter = defineCliAdapter({
  id: 'claude-code',
  name: 'Claude Code',
  description:
    'Anthropic 官方 Claude Code CLI。已订阅 Anthropic 的用户可直接复用额度。Tool 模式为一次任务执行；完整能力在 Agent 模式（V2 支持 stdio-jsonrpc 时启用）。',
  icon: '🧠',
  vendor: 'Anthropic',
  officialDoc: 'https://docs.anthropic.com/en/docs/claude-code',
  installHint: 'npm i -g @anthropic-ai/claude-code，然后 claude auth login',
  defaultEnabled: true,

  fingerprint: {
    commandNames: ['claude', 'claude-code', 'claude-cli', 'claude-agent'],
    versionArgs: ['--version'],
    versionPattern: /(?:claude\s*code|claude)\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.anthropic', '~/Library/Application Support/Claude Code', '~/.claude'],
    envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_API_KEY'],
    authCheck: {
      cmd: 'claude auth status',
      // claude v2.1.x 输出 JSON（多行），例如:
      //   { "loggedIn": true, "subscriptionType": "pro", ... }
      expectAuthenticated:
        /(^|\s|"|,)loggedIn["\s]*:[\s"]*true(,|\s|}|"|$)|"subscriptionType"[\s:]*"(pro|team)"/i,
      expectUnauthenticated:
        /(^|\s|"|,)loggedIn["\s]*:[\s"]*false(,|\s|}|"|$)|not logged|no.*key|unauthenticated|please.*(login|sign)/i,
    },
  },

  capabilities: {
    // === Tool 模式：一次性任务执行（V1 先提供，简单但够用）===
    tools: [
      {
        dshToolName: 'cli-hub:claude-code:run-task',
        description:
          '用本机 Claude Code CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 Anthropic API Key/额度）。适合"让 Claude 写一段代码/分析一段文本/草拟内容"等短平快任务。长流程/多轮任务请走 Agent 模式。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            workdir: {
              type: 'string',
              description: '执行工作目录（默认 = 当前 DSH workspace）',
            },
            maxTurns: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
            timeoutSeconds: { type: 'integer', minimum: 10, maximum: 600, default: 180 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'resolver',
          resolver: (input, rtx) => {
            const merged = input.context ? `${input.context}\n\n---- TASK ----\n${input.task}` : input.task;
            // Claude Code v2.1.x 真实 CLI flags：
            //   -p                          非交互模式
            //   --output-format json        单个 JSON 结果（非流式）
            //   --add-dir <dir>             授予工具访问权限
            //   --model auto                模型自动选择
            //   --permission-mode acceptEdits  自动接受编辑（避免 hang 在权限提示上）
            //   --                          之后是 prompt 位置参数
            // 注：--max-turns / --workspace / --no-confirm / --format 在 v2.1.x 已不存在
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
            // Claude --format json 输出 JSON；兼容失败情况
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

    // === Agent 模式 V2：完整 stream-json stdio（Claude Code 真实协议）===
    // Claude Code v2.1.x 的 stream-json 协议：
    //   输入：每行一个 JSON 事件，例如
    //     {"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
    //   输出：每行一个 JSON 事件，按顺序：
    //     1) {"type":"system","subtype":"hook_started",...}     （SessionStart 钩子，spawn 后立即发出）
    //     2) {"type":"system","subtype":"hook_response",...}    （钩子结果）
    //     3) {"type":"system","subtype":"init","cwd":...,"tools":[...],...}  （会话初始化完成）
    //     4) {"type":"assistant","message":{...content:[{type:"text","text":"..."}]...}}
    //     5) {"type":"result","is_error":false,"result":"...","usage":{...}}  （最终结果）
    // 完整文档：https://docs.claude.com/en/docs/claude-code/sdk/streaming
    //
    // 注意：subtype=init 仅在收到第一条 user 输入后才会发出。但 AgentGateway
    // 是「先等 ready 再 send」的语义，会死锁。因此 readyPattern 选 hook_started
    // （spawn 后立即触发），让 send 尽早开始；后续 hook_response / init 事件
    // 仍然通过 recv() 暴露给调用方。
    agent: {
      protocol: 'stream-json',
      spawn: {
        command: 'claude',
        // Claude Code 没有原生 --workspace 参数；通过 spawn cwd 设置工作目录，
        // 通过 --add-dir 授予工具访问权限（CLAUDE.md 自动发现也基于此目录）。
        argsTemplate: [
          '-p',                              // print 模式（非交互）
          '--output-format', 'stream-json',  // 流式 JSON 输出
          '--input-format', 'stream-json',   // 流式 JSON 输入
          '--verbose',                       // 完整事件流
          '--add-dir', '{{workspace}}',      // 授予工作目录的访问权限
        ],
        // ready 信号：subtype=hook_started 是 claude spawn 后立即发出的第一个事件
        readyPattern: '"subtype":"hook_started"',
        readyTimeoutMs: 30_000,              // 首次启动可能要加载 hooks/MCP，给足时间
        gracefulShutdownSignal: 'SIGINT',
        shutdownGraceMs: 3000,
      },
      agentMeta: {
        displayName: 'Claude Code',
        description: 'Anthropic 官方 Agent，代码/推理强。共享 DSH 已配的 MCP 工具与凭证。',
        avatarEmoji: '🧠',
        strengths: ['代码', '推理', '写作'],
        supportsStreaming: true,
      },
      shareDshTools: true,
    },
  },

  quota: {
    method: {
      kind: 'unknown',  // Claude Code 没有 "quota" 子命令；靠本地估算
    },
    estimatePerAgentTurn: (inTk, outTk) => {
      // Claude 3.5 Sonnet 粗略估算：in $3/M, out $15/M → 综合 ~$5/1M tokens 的 1:1 credit
      return Math.round((inTk + outTk) / 100);  // 每 100 tokens ~= 1 credit
    },
  },

  minimumVersion: '0.12.0',
});
