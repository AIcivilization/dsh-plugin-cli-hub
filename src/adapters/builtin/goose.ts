/**
 * Goose Adapter —— Tool 模式
 *
 * Goose：Block 出品的终端 AI Agent。
 *   goose run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const gooseAdapter = defineCliAdapter({
  id: 'goose',
  name: 'Goose',
  description:
    'Block Goose 终端 AI Agent。原生支持多种 LLM provider 与 MCP 工具，可作为 Tool 模式的"任务执行器"使用。',
  icon: '🪿',
  vendor: 'Block',
  officialDoc: 'https://github.com/block/goose',
  installHint: 'curl -fsSL https://github.com/block/goose/releases/latest/download/install.sh | bash',

  fingerprint: {
    commandNames: ['goose'],
    versionArgs: ['--version'],
    versionPattern: /goose\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/goose', '~/Library/Application Support/Goose'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOSE_API_KEY', 'DATABRICKS_TOKEN'],
    authCheck: {
      cmd: 'goose auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:goose:run-task',
        description:
          '用本机 Goose 一次性执行一个文本任务并返回结果（自动复用已配置的 LLM API Key/额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
            model: {
              type: 'string',
              description: '模型名（留空使用默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'goose run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.10.0',
});
