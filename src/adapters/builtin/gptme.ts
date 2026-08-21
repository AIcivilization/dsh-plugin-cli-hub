/**
 * gptme CLI Adapter —— Tool 模式
 *
 * Erik Bjäreholt 的 gptme CLI：终端 AI 助手，支持工具调用 + 文件读写 + 执行代码。
 *   gptme exec --json "<task>"
 *
 * 复用 OpenAI / Anthropic / 本地模型额度。
 */
import { defineCliAdapter } from '../define';

export const gptmeAdapter = defineCliAdapter({
  id: 'gptme',
  name: 'gptme CLI',
  description:
    'Erik Bjäreholt 的 gptme CLI。终端 AI 助手，支持工具调用、文件读写、执行代码，可作 Tool 模式执行任务。',
  icon: '🤖',
  vendor: 'Erik Bjäreholt',
  officialDoc: 'https://github.com/ErikBjare/gptme',
  installHint: 'pip install gptme 或 pipx install gptme，然后 gptme --config set api_key ...',

  fingerprint: {
    commandNames: ['gptme'],
    versionArgs: ['--version'],
    versionPattern: /gptme[,\s]+version\s*([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/gptme', '~/.gptme'],
    envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    authCheck: {
      cmd: 'gptme --version',
      expectAuthenticated: /gptme/i, // gptme 不强制 auth，只要装了就能用（首次执行会失败）
      expectUnauthenticated: /command not found/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:gptme:exec',
        description: '用 gptme CLI 执行一个 Agent 任务（支持工具调用 + 文件读写 + 执行代码）。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述' },
            model: { type: 'string', description: '模型 ID（如 gpt-4o, claude-3-5-sonnet）' },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'gptme --non-interactive --model {{model}} --cwd {{workdir}} "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 15,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
