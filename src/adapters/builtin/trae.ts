/**
 * Trae CLI Adapter —— Tool mode
 *
 * ByteDance Trae CLI: ByteDance's official Trae CLI; reuses the Trae account quota.
 *   trae --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const traeAdapter = defineCliAdapter({
  id: 'trae',
  name: 'Trae CLI',
  description:
    'ByteDance Trae CLI. Users with a Trae subscription can directly reuse their API quota and use it as a one-shot task executor. Strong performance in both Chinese-language and coding scenarios; ideal for short, quick tasks like "write a piece of code / analyze text / draft content".',
  icon: '🌈',
  vendor: 'ByteDance',
  officialDoc: 'https://docs.trae.ai',
  installHint: 'npm i -g @trae/cli, then trae auth login',

  fingerprint: {
    commandNames: ['trae', 'trae-cli', 'trae-agent', 'agent-tool-host', 'ctx-cli'],
    versionArgs: ['--version'],
    versionPattern: /trae(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.trae', '~/Library/Application Support/Trae'],
    envVars: ['TRAE_API_KEY', 'TRAE_TOKEN', 'BYTEDANCE_API_KEY'],
    authCheck: {
      cmd: 'trae auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:trae:run-task',
        description:
          'Execute a one-shot text task with the local Trae CLI and return the result (automatically reuses the logged-in Trae account quota). Ideal for short, quick tasks like "have Trae write a piece of code / analyze a piece of text / draft content"; strong performance in both Chinese-language and coding scenarios.',
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
              description: 'Model name (leave empty for default)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'trae --message "{{task}}" --model {{model}} --cwd {{workdir}}',
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
