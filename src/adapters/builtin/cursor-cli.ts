/**
 * Cursor CLI Adapter - Tool mode
 *
 * Cursor CLI: command line and background agents of Cursor IDE.
 *   cursor run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const cursorCliAdapter = defineCliAdapter({
  id: 'cursor-cli',
  name: 'Cursor CLI',
  description:
    'Cursor IDE CLI and background agents. Runs coding tasks in the terminal, reusing your Cursor subscription quota; serves as the "task executor" in Tool mode.',
  icon: '🖱️',
  vendor: 'Anysphere',
  officialDoc: 'https://docs.cursor.com',
  installHint: 'npm i -g @cursor/cli, or "Install CLI" inside Cursor IDE, then cursor login',

  fingerprint: {
    commandNames: ['cursor', 'cursor-cli', 'cursor-agent'],
    versionArgs: ['--version'],
    versionPattern: /cursor(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.cursor', '~/Library/Application Support/Cursor'],
    envVars: ['CURSOR_API_KEY', 'CURSOR_TOKEN'],
    authCheck: {
      cmd: 'cursor auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:cursor-cli:run-task',
        description:
          'Run a one-shot text task on local Cursor CLI and return the result (reuses your Cursor subscription quota automatically). Suited for code editing / text analysis / content drafting tasks.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g. code snippets, file contents, explanations)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory to execute in (defaults to the current DSH workspace)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default, e.g. cursor-small / gpt-4o / claude-3.7-sonnet)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'cursor run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.5.0',
});
