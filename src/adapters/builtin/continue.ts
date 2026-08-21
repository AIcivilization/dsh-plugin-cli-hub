/**
 * Continue Adapter —— Tool 模式
 *
 * Continue.dev CLI：开源 AI 编码助手，支持多种 LLM provider。
 *   continue run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const continueAdapter = defineCliAdapter({
  id: 'continue',
  name: 'Continue',
  description:
    'Continue.dev 开源 CLI。支持 Anthropic/OpenAI/DeepSeek 等多种 LLM provider，可作为 Tool 模式的"任务执行器"使用。',
  icon: '➡️',
  vendor: 'ContinueDev',
  officialDoc: 'https://www.continue.dev',
  installHint: 'npm i -g @continuedev/cli 或 pip install continuedev，然后 export ANTHROPIC_API_KEY 或 OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['continue', 'continuedev'],
    versionArgs: ['--version'],
    versionPattern: /continue(?:dev)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.continue', '~/.config/continue'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CONTINUE_API_KEY', 'DEEPSEEK_API_KEY'],
    authCheck: {
      cmd: 'continue auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:continue:run-task',
        description:
          '用本机 Continue CLI 一次性执行一个文本任务并返回结果（自动复用已配置的 LLM API Key/额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
          template: 'continue run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.9.0',
});
