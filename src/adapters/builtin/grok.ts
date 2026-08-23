/**
 * Grok CLI Adapter —— Tool mode
 *
 * xAI Grok CLI: xAI's official AI coding assistant; reuses the xAI account quota.
 *   grok --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const grokAdapter = defineCliAdapter({
  id: 'grok',
  name: 'Grok CLI',
  description:
    'xAI Grok CLI. Users with an xAI subscription can directly reuse their API quota and use it as a one-shot task executor. Ideal for short, quick tasks like "write a piece of code / analyze text / draft content".',
  icon: '🌌',
  vendor: 'xAI',
  officialDoc: 'https://github.com/xai-org/grok-cli',
  installHint: 'npm i -g @xai/grok-cli, then export XAI_API_KEY=xai-...',

  fingerprint: {
    commandNames: ['grok', 'grok-cli', 'grok-agent'],
    versionArgs: ['--version'],
    versionPattern: /grok(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.grok', '~/.config/grok'],
    envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
    authCheck: {
      cmd: 'grok auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:grok:run-task',
        description:
          'Execute a one-shot text task with the local Grok CLI and return the result (automatically reuses the logged-in xAI API Key/quota). Ideal for short, quick tasks like "have Grok write a piece of code / analyze a piece of text / draft content".',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g., code snippets, file contents, notes)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory for execution (default = current DSH workspace)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default, e.g., grok-3 / grok-4)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'grok --message "{{task}}" --model {{model}} --cwd {{workdir}}',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
