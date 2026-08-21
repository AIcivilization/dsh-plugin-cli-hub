/**
 * Cline Adapter —— Tool 模式
 *
 * Cline：开源 VS Code + CLI Agent，支持多种 LLM provider。
 *   cline run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const clineAdapter = defineCliAdapter({
  id: 'cline',
  name: 'Cline',
  description:
    'Cline 开源 VS Code + CLI Agent。支持 Anthropic/OpenAI/DeepSeek 等多种 LLM provider，可作为 Tool 模式的"任务执行器"使用。',
  icon: '🤖',
  vendor: 'Cline',
  officialDoc: 'https://github.com/cline/cline',
  installHint: 'npm i -g @anthropic-ai/cline，然后 export ANTHROPIC_API_KEY 或 OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['cline'],
    versionArgs: ['--version'],
    versionPattern: /cline\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.cline', '~/.config/cline'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLINE_API_KEY', 'DEEPSEEK_API_KEY'],
    authCheck: {
      cmd: 'cline auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:cline:run-task',
        description:
          '用本机 Cline 一次性执行一个文本任务并返回结果（自动复用已配置的 LLM API Key/额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
          template: 'cline run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '1.0.0',
});
