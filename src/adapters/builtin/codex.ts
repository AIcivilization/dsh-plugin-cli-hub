/**
 * Codex CLI Adapter —— Tool 模式
 *
 * OpenAI Codex CLI：官方 AI 编码助手，复用 OpenAI 账户额度。
 *   codex exec --json "<task>"
 */
import { defineCliAdapter } from '../define';

export const codexAdapter = defineCliAdapter({
  id: 'codex',
  name: 'Codex CLI',
  description:
    'OpenAI Codex CLI。已订阅 OpenAI 的用户可直接复用 API 额度，作为一次性任务执行器使用。适合"写一段代码/分析文本/草拟内容"等短平快任务。',
  icon: '⚡',
  vendor: 'OpenAI',
  officialDoc: 'https://github.com/openai/codex',
  installHint: 'npm i -g @openai/codex，然后 export OPENAI_API_KEY=sk-...',

  fingerprint: {
    commandNames: ['codex', 'openai-codex', 'codex-cli', 'codex-code-mode-host'],
    versionArgs: ['--version'],
    versionPattern: /codex(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.codex', '~/.config/codex'],
    envVars: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    authCheck: {
      cmd: 'codex auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:codex:run-task',
        description:
          '用本机 Codex CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 OpenAI API Key/额度）。适合"让 Codex 写一段代码/分析一段文本/草拟内容"等短平快任务。',
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
              description: '模型名（留空使用默认，如 gpt-5 / o3）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'codex',
          args: [
            'exec',
            '--json',
            { flag: '--model', var: 'model' },
            { flag: '--cwd', var: 'workdir' },
            { var: 'task' },
          ],
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
