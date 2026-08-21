/**
 * Paperclip AI CLI Adapter —— Tool 模式
 *
 * PaperclipAI 开源 Agent CLI，支持多种模型路由。
 *   paperclipai run --json "<task>"
 *
 * 复用 PaperclipAI 平台账户额度。
 */
import { defineCliAdapter } from '../define';

export const paperclipaiAdapter = defineCliAdapter({
  id: 'paperclipai',
  name: 'PaperclipAI CLI',
  description:
    'PaperclipAI 开源 Agent CLI。支持多模型路由与工具调用，可作 Tool 模式执行复杂任务。',
  icon: '📎',
  vendor: 'PaperclipAI',
  officialDoc: 'https://github.com/paperclip-ai/paperclip-cli',
  installHint: 'npm i -g paperclipai，然后 paperclipai auth login',

  fingerprint: {
    commandNames: ['paperclipai', 'paperclip', 'paperclip-cli'],
    versionArgs: ['--version'],
    versionPattern: /paperclip(?:ai|[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.paperclipai', '~/.config/paperclip'],
    envVars: ['PAPERCLIP_API_KEY', 'PAPERCLIP_TOKEN'],
    authCheck: {
      cmd: 'paperclipai auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:paperclipai:run-task',
        description: '用 PaperclipAI CLI 执行一个 Agent 任务（多模型路由 + 工具调用）。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述' },
            model: { type: 'string', description: '指定模型（留空用默认路由）' },
            tools: { type: 'string', description: '允许工具列表（逗号分隔，如 "bash,fs,web"）' },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'paperclipai run --model {{model}} --tools {{tools}} --cwd {{workdir}} --json "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
