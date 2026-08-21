/**
 * Junie Adapter —— Tool 模式
 *
 * JetBrains Junie CLI：JetBrains 官方 AI 编码 Agent。
 *   junie run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const junieAdapter = defineCliAdapter({
  id: 'junie',
  name: 'Junie',
  description:
    'JetBrains Junie CLI。官方 AI 编码 Agent，复用 JetBrains AI 订阅额度，可作为 Tool 模式的"任务执行器"使用。',
  icon: '🚀',
  vendor: 'JetBrains',
  officialDoc: 'https://www.jetbrains.com/junie',
  installHint: 'curl -fsSL https://www.jetbrains.com/junie/install.sh | bash 或在 JetBrains IDE 内安装',

  fingerprint: {
    commandNames: ['junie'],
    versionArgs: ['--version'],
    versionPattern: /junie\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.junie', '~/Library/Application Support/JetBrains/Junie'],
    envVars: ['JETBRAINS_API_KEY', 'JUNIE_API_KEY', 'JETBRAINS_TOKEN'],
    authCheck: {
      cmd: 'junie auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:junie:run-task',
        description:
          '用本机 Junie 一次性执行一个文本任务并返回结果（自动复用 JetBrains AI 订阅额度）。适合"修改代码/分析文本/草拟内容"等任务。',
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
              description: '执行工作目录（默认 = 当前 DSH workspace，建议为 JetBrains 项目）',
            },
            model: {
              type: 'string',
              description: '模型名（留空使用默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'junie run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
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
