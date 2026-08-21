/**
 * Cursor CLI Adapter —— Tool 模式
 *
 * Cursor CLI：Cursor IDE 的命令行与 background agent。
 *   cursor run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const cursorCliAdapter = defineCliAdapter({
  id: 'cursor-cli',
  name: 'Cursor CLI',
  description:
    'Cursor IDE CLI 与 background agent。支持在终端执行编码任务，复用 Cursor 订阅额度，可作为 Tool 模式的"任务执行器"使用。',
  icon: '🖱️',
  vendor: 'Anysphere',
  officialDoc: 'https://docs.cursor.com',
  installHint: 'npm i -g @cursor/cli 或在 Cursor IDE 内"Install CLI"，然后 cursor login',

  fingerprint: {
    commandNames: ['cursor', 'cursor-cli'],
    versionArgs: ['--version'],
    versionPattern: /cursor(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.cursor', '~/Library/Application Support/Cursor'],
    envVars: ['CURSOR_API_KEY', 'CURSOR_TOKEN'],
    authCheck: {
      cmd: 'cursor auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:cursor-cli:run-task',
        description:
          '用本机 Cursor CLI 一次性执行一个文本任务并返回结果（自动复用 Cursor 订阅额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
              description: '模型名（留空使用默认，如 cursor-small / gpt-4o / claude-3.7-sonnet）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'cursor run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
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
