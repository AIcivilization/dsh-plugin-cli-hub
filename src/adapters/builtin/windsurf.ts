/**
 * Windsurf Adapter —— Tool 模式
 *
 * Windsurf/Devin Desktop CLI：Codeium 出品的 AI 编码 Agent。
 *   windsurf run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const windsurfAdapter = defineCliAdapter({
  id: 'windsurf',
  name: 'Windsurf',
  description:
    'Windsurf/Devin Desktop CLI（Codeium 出品）。AI 编码 Agent，复用 Codeium 订阅额度，可作为 Tool 模式的"任务执行器"使用。',
  icon: '🏄',
  vendor: 'Codeium',
  officialDoc: 'https://docs.windsurf.com',
  installHint: 'curl -fsSL https://windsurf.com/install.sh | bash 或在 Windsurf IDE 内安装',

  fingerprint: {
    commandNames: ['windsurf', 'windsurf-cli', 'devin-desktop'],
    versionArgs: ['--version'],
    versionPattern: /windsurf\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.windsurf', '~/Library/Application Support/Windsurf'],
    envVars: ['WINDSURF_API_KEY', 'CODEIUM_API_KEY', 'WINDSURF_TOKEN'],
    authCheck: {
      cmd: 'windsurf auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:windsurf:run-task',
        description:
          '用本机 Windsurf 一次性执行一个文本任务并返回结果（自动复用 Codeium 订阅额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
              description: '模型名（留空使用默认，如 windsurf-default / gpt-4o / claude-3.7-sonnet）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'windsurf run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
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
