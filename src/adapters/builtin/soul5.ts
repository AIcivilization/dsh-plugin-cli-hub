/**
 * Soul5 CLI Adapter — Tool mode
 *
 * Soul5 open-source AI Agent CLI focused on long-running task orchestration and multi-agent collaboration.
 *   soul5 run --json "<task>"
 *
 * Reuses the Soul5 platform account quota.
 */
import { defineCliAdapter } from '../define';

export const soul5Adapter = defineCliAdapter({
  id: 'soul5',
  name: 'Soul5 CLI',
  description:
    'Soul5 open-source AI Agent CLI. Long-running task orchestration and multi-agent collaboration; suited for complex workflow automation.',
  icon: '🜂',
  vendor: 'Soul5',
  officialDoc: 'https://github.com/soul5/soul5-cli',
  installHint: 'npm i -g soul5, then soul5 auth login',

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
        description: 'Run a multi-step workflow task via the Soul5 CLI (multi-agent collaboration supported).',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            agents: {
              type: 'string',
              description: 'List of participating agents (comma-separated, e.g. "researcher,coder,reviewer")',
            },
            maxSteps: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            workdir: { type: 'string', description: 'Working directory' },
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
