/**
 * Gemini CLI Adapter —— Tool 模式
 *
 * Google Gemini CLI：官方 AI 助手，复用 Google 账户额度。
 *   gemini -p "<task>"
 */
import { defineCliAdapter } from '../define';

export const geminiCliAdapter = defineCliAdapter({
  id: 'gemini-cli',
  name: 'Gemini CLI',
  description:
    'Google Gemini CLI。已订阅 Google AI 的用户可直接复用 API 额度，作为一次性任务执行器使用。适合"写一段代码/分析文本/草拟内容"等短平快任务。',
  icon: '💎',
  vendor: 'Google',
  officialDoc: 'https://github.com/google-gemini/gemini-cli',
  installHint: 'npm i -g @anthropic-ai/gemini-cli，然后 export GEMINI_API_KEY=...',

  fingerprint: {
    commandNames: ['gemini', 'gemini-cli', 'gemini-cli-v2'],
    versionArgs: ['--version'],
    versionPattern: /gemini(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.gemini', '~/.config/gemini'],
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT'],
    authCheck: {
      cmd: 'gemini auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:gemini-cli:run-task',
        description:
          '用本机 Gemini CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 Google API Key/额度）。适合"让 Gemini 写一段代码/分析一段文本/草拟内容"等短平快任务。',
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
              description: '模型名（留空使用默认，如 gemini-2.5-pro）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'gemini -p --model {{model}} --cwd {{workdir}} "{{task}}"',
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
