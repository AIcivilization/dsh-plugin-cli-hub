/**
 * Codex CLI Adapter —— Tool mode
 *
 * OpenAI Codex CLI: the official AI coding assistant; reuses the OpenAI account quota.
 *   codex exec --json "<task>"
 */
import { defineCliAdapter } from '../define';

export const codexAdapter = defineCliAdapter({
  id: 'codex',
  name: 'Codex CLI',
  description:
    'OpenAI Codex CLI. Users with an OpenAI subscription can directly reuse their API quota and use it as a one-shot task executor. Ideal for short, quick tasks like "write a piece of code / analyze text / draft content".',
  icon: '⚡',
  vendor: 'OpenAI',
  officialDoc: 'https://github.com/openai/codex',
  installHint: 'npm i -g @openai/codex, then export OPENAI_API_KEY=sk-...',

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
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:codex:run-task',
        description:
          'Execute a one-shot text task with the local Codex CLI and return the result (automatically reuses the logged-in OpenAI API Key/quota). Ideal for short, quick tasks like "have Codex write a piece of code / analyze a piece of text / draft content".',
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
              description: 'Model name (leave empty for default, e.g., gpt-5 / o3)',
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
