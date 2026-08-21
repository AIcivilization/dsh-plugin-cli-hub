/**
 * OpenCode Adapter —— Tool 模式
 *
 * OpenCode：支持 75+ provider 的终端 AI Agent。
 *   opencode run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const opencodeAdapter = defineCliAdapter({
  id: 'opencode',
  name: 'OpenCode',
  description:
    'OpenCode 终端 AI Agent。原生支持 75+ provider（Anthropic/OpenAI/DeepSeek/Google/xAI 等），可作为 Tool 模式的"任务执行器"使用。',
  icon: '✨',
  vendor: 'OpenCode',
  officialDoc: 'https://github.com/sst/opencode',
  installHint: 'npm i -g opencode，然后 export ANTHROPIC_API_KEY 或 OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['opencode', 'opencode-cli', 'opencode-agent'],
    versionArgs: ['--version'],
    versionPattern: /opencode\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.opencode', '~/.config/opencode'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY'],
    authCheck: {
      cmd: 'opencode auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:opencode:run-task',
        description:
          '用本机 OpenCode 一次性执行一个文本任务并返回结果（自动复用已配置的 LLM API Key/额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
            provider: {
              type: 'string',
              description: 'provider 名（如 anthropic/openai/deepseek/xai 等，留空使用默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template:
            'opencode run --task "{{task}}" --cwd {{workdir}} --model {{model}} --provider {{provider}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.5.0',
});
