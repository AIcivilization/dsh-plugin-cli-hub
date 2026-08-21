/**
 * OpenClaudia CLI Adapter —— Tool 模式
 *
 * OpenClaudia 开源 Claude Code 替代 CLI，主打可定制性 + 多 provider 路由。
 *   openclaudia run --json "<task>"
 *
 * 复用 Anthropic / OpenAI / DeepSeek 等多种 provider 额度。
 */
import { defineCliAdapter } from '../define';

export const openclaudiaAdapter = defineCliAdapter({
  id: 'openclaudia',
  name: 'OpenClaudia CLI',
  description:
    'OpenClaudia 开源 Claude Code 替代 CLI。支持多 provider 路由（Anthropic/OpenAI/DeepSeek），可作 Tool 模式使用。',
  icon: '🔓',
  vendor: 'OpenClaudia',
  officialDoc: 'https://github.com/openclaudia/openclaudia-cli',
  installHint: 'npm i -g @openclaudia/cli 或 pip install openclaudia，然后 openclaudia auth login',

  fingerprint: {
    commandNames: ['openclaudia', 'openclaudia-cli'],
    versionArgs: ['--version'],
    versionPattern: /openclaudia(?:[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.openclaudia', '~/.config/openclaudia'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'],
    authCheck: {
      cmd: 'openclaudia auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:openclaudia:run-task',
        description: '用 OpenClaudia CLI 执行一个编码任务（多 provider 路由）。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述' },
            provider: { type: 'string', description: 'provider（anthropic/openai/deepseek，留空用默认）' },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'openclaudia run --provider {{provider}} --cwd {{workdir}} --json "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 15,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
