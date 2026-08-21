/**
 * Trae CLI Adapter —— Tool 模式
 *
 * ByteDance Trae CLI：字节跳动 Trae 官方 CLI，复用 Trae 账户额度。
 *   trae --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const traeAdapter = defineCliAdapter({
  id: 'trae',
  name: 'Trae CLI',
  description:
    'ByteDance Trae CLI。已订阅 Trae 的用户可直接复用 API 额度，作为一次性任务执行器使用。中文场景与代码场景均表现强，适合"写一段代码/分析文本/草拟内容"等短平快任务。',
  icon: '🌈',
  vendor: 'ByteDance',
  officialDoc: 'https://docs.trae.ai',
  installHint: 'npm i -g @trae/cli，然后 trae auth login',

  fingerprint: {
    commandNames: ['trae', 'trae-cli', 'trae-agent', 'agent-tool-host', 'ctx-cli'],
    versionArgs: ['--version'],
    versionPattern: /trae(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.trae', '~/Library/Application Support/Trae'],
    envVars: ['TRAE_API_KEY', 'TRAE_TOKEN', 'BYTEDANCE_API_KEY'],
    authCheck: {
      cmd: 'trae auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:trae:run-task',
        description:
          '用本机 Trae CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 Trae 账户额度）。适合"让 Trae 写一段代码/分析一段文本/草拟内容"等短平快任务，中文与代码场景均表现强。',
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
          template: 'trae --message "{{task}}" --model {{model}} --cwd {{workdir}}',
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
