/**
 * smol AI CLI Adapter —— Tool 模式
 *
 * smol-ai/smol-developer 系列 CLI：早期开源 AI 软件工程师，主打"PM → 代码"流程。
 *   smol --prompt "<task>" --json
 *
 * 复用 OpenAI API Key。
 */
import { defineCliAdapter } from '../define';

export const smolAdapter = defineCliAdapter({
  id: 'smol',
  name: 'smol Developer CLI',
  description:
    'smol-ai/smol-developer 早期开源 AI 软件工程师 CLI。主打"PM → 代码"流程，可作 Tool 模式使用。',
  icon: '🤏',
  vendor: 'smol-ai',
  officialDoc: 'https://github.com/smol-ai/smol-developer',
  installHint: 'npm i -g @smol/cli 或 pip install smol-developer，然后 export OPENAI_API_KEY=...',

  fingerprint: {
    commandNames: ['smol', 'smol-developer', 'smol-cli'],
    versionArgs: ['--version'],
    versionPattern: /smol(?:[-\s]developer)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.smol', '~/.config/smol'],
    envVars: ['OPENAI_API_KEY'],
    authCheck: {
      cmd: 'smol --version',
      expectAuthenticated: /smol/i,
      expectUnauthenticated: /no.*api.*key/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:smol:develop',
        description: '用 smol CLI 执行一个"PM → 代码"任务（输入需求描述，输出代码）。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 2, maxLength: 8000, description: '需求描述（PM-style）' },
            model: { type: 'string', description: 'OpenAI 模型（如 gpt-4o）' },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'smol --prompt "{{prompt}}" --model {{model}} --cwd {{workdir}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 25,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
