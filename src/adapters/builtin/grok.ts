/**
 * Grok CLI Adapter —— Tool 模式
 *
 * xAI Grok CLI：xAI 官方 AI 编码助手，复用 xAI 账户额度。
 *   grok --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const grokAdapter = defineCliAdapter({
  id: 'grok',
  name: 'Grok CLI',
  description:
    'xAI Grok CLI。已订阅 xAI 的用户可直接复用 API 额度，作为一次性任务执行器使用。适合"写一段代码/分析文本/草拟内容"等短平快任务。',
  icon: '🌌',
  vendor: 'xAI',
  officialDoc: 'https://github.com/xai-org/grok-cli',
  installHint: 'npm i -g @xai/grok-cli，然后 export XAI_API_KEY=xai-...',

  fingerprint: {
    commandNames: ['grok', 'grok-cli'],
    versionArgs: ['--version'],
    versionPattern: /grok(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.grok', '~/.config/grok'],
    envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
    authCheck: {
      cmd: 'grok auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:grok:run-task',
        description:
          '用本机 Grok CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 xAI API Key/额度）。适合"让 Grok 写一段代码/分析一段文本/草拟内容"等短平快任务。',
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
              description: '模型名（留空使用默认，如 grok-3 / grok-4）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'grok --message "{{task}}" --model {{model}} --cwd {{workdir}}',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
