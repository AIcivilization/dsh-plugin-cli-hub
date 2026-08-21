/**
 * Soul5 CLI Adapter —— Tool 模式
 *
 * Soul5 开源 AI Agent CLI，主打长任务编排与多 Agent 协作。
 *   soul5 run --json "<task>"
 *
 * 复用 Soul5 平台账户额度。
 */
import { defineCliAdapter } from '../define';

export const soul5Adapter = defineCliAdapter({
  id: 'soul5',
  name: 'Soul5 CLI',
  description:
    'Soul5 开源 AI Agent CLI。支持长任务编排、多 Agent 协作，适合复杂工作流自动化任务。',
  icon: '🜂',
  vendor: 'Soul5',
  officialDoc: 'https://github.com/soul5/soul5-cli',
  installHint: 'npm i -g soul5，然后 soul5 auth login',

  fingerprint: {
    commandNames: ['soul5', 'soul5-cli'],
    versionArgs: ['--version'],
    versionPattern: /soul5(?:[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.soul5', '~/.config/soul5'],
    envVars: ['SOUL5_API_KEY', 'SOUL5_TOKEN'],
    authCheck: {
      cmd: 'soul5 auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:soul5:run-workflow',
        description: '用 Soul5 CLI 执行一个多步工作流任务（支持多 Agent 协作）。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述' },
            agents: {
              type: 'string',
              description: '指定参与 Agent 列表（逗号分隔，如 "researcher,coder,reviewer"）',
            },
            maxSteps: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'soul5 run --agents {{agents}} --max-steps {{maxSteps}} --cwd {{workdir}} --json "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 1200_000,
        estimatedCredits: 50,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
