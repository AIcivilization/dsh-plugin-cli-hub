/**
 * Devin Desktop CLI Adapter —— Tool 模式
 *
 * Cognition AI Devin 的桌面端 CLI（devin-desktop 二进制）。
 *   devin-desktop run --json "<task>"
 *
 * 复用 Devin 订阅额度。
 */
import { defineCliAdapter } from '../define';

export const devinDesktopAdapter = defineCliAdapter({
  id: 'devin-desktop',
  name: 'Devin Desktop CLI',
  description:
    'Cognition AI Devin 桌面端 CLI。已订阅 Devin 的用户可直接复用账户额度，作为自主软件工程师 Tool 使用。',
  icon: '🤖',
  vendor: 'Cognition AI',
  officialDoc: 'https://docs.cognition.ai/devin/desktop',
  installHint: '在 Devin Desktop 应用内"Install CLI"，或下载 devin-desktop 二进制到 ~/.codeium/windsurf/bin',

  fingerprint: {
    commandNames: ['devin-desktop', 'devin'],
    versionArgs: ['--version'],
    versionPattern: /devin(?:[-\s]desktop)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.codeium/windsurf', '~/Library/Application Support/Devin'],
    envVars: ['DEVIN_API_KEY', 'COGNITION_API_KEY', 'WINDSURF_TOKEN'],
    authCheck: {
      cmd: 'devin-desktop auth status',
      expectAuthenticated: /(valid|ok|active|authenticated|signed in)/i,
      expectUnauthenticated: /(no.*token|not.*signed|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:devin-desktop:run-task',
        description: '用 Devin Desktop CLI 执行一个自主软件工程任务。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述（如"实现一个登录页面"）' },
            repo: { type: 'string', description: '目标仓库路径（默认当前 workspace）' },
            maxSteps: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'devin-desktop run --repo {{repo}} --max-steps {{maxSteps}} --json "{{task}}"',
        },
        outputParser: 'stdout-json',
        timeoutMs: 1800_000,
        estimatedCredits: 100,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
