/**
 * OpenClaudia CLI Adapter —— Tool mode
 *
 * OpenClaudia is an open-source Claude Code alternative CLI focused on customizability + multi-provider routing.
 *   openclaudia run --json "<task>"
 *
 * Reuses quota from multiple providers such as Anthropic / OpenAI / DeepSeek.
 */
import { defineCliAdapter } from '../define';

export const openclaudiaAdapter = defineCliAdapter({
  id: 'openclaudia',
  name: 'OpenClaudia CLI',
  description:
    'OpenClaudia is an open-source Claude Code alternative CLI. Supports multi-provider routing (Anthropic/OpenAI/DeepSeek); usable in Tool mode.',
  icon: '🔓',
  vendor: 'OpenClaudia',
  officialDoc: 'https://github.com/openclaudia/openclaudia-cli',
  installHint: 'npm i -g @openclaudia/cli or pip install openclaudia, then run openclaudia auth login',

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
        description: 'Run a coding task via the OpenClaudia CLI (multi-provider routing).',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            provider: { type: 'string', description: 'Provider (anthropic/openai/deepseek; leave empty for default)' },
            workdir: { type: 'string', description: 'Working directory for the task' },
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
