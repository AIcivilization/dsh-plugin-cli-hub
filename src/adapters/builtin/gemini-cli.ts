/**
 * Gemini CLI Adapter —— Tool mode
 *
 * Google Gemini CLI: the official AI assistant; reuses the Google account quota.
 *   gemini -p "<task>"
 */
import { defineCliAdapter } from '../define';

export const geminiCliAdapter = defineCliAdapter({
  id: 'gemini-cli',
  name: 'Gemini CLI',
  description:
    'Google Gemini CLI. Users with a Google AI subscription can directly reuse their API quota and use it as a one-shot task executor. Ideal for short, quick tasks like "write a piece of code / analyze text / draft content".',
  icon: '💎',
  vendor: 'Google',
  officialDoc: 'https://github.com/google-gemini/gemini-cli',
  installHint: 'npm i -g @anthropic-ai/gemini-cli, then export GEMINI_API_KEY=...',
  login: {
    cmd: 'gemini',
    note: 'First launch opens Google account OAuth in the browser; alternatively set GEMINI_API_KEY.',
  },

  fingerprint: {
    commandNames: ['gemini', 'gemini-cli', 'gemini-cli-v2'],
    versionArgs: ['--version'],
    versionPattern: /gemini(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.gemini', '~/.config/gemini'],
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT'],
    authCheck: {
      cmd: 'gemini auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:gemini-cli:run-task',
        description:
          'Execute a one-shot text task with the local Gemini CLI and return the result (automatically reuses the logged-in Google API Key/quota). Ideal for short, quick tasks like "have Gemini write a piece of code / analyze a piece of text / draft content".',
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
              description: 'Model name (leave empty for default, e.g., gemini-2.5-pro)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'gemini -p --model {{model}} --cwd {{workdir}} "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 15,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
