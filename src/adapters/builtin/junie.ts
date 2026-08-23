/**
 * Junie Adapter —— Tool mode
 *
 * JetBrains Junie CLI: the official JetBrains AI coding agent.
 *   junie run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const junieAdapter = defineCliAdapter({
  id: 'junie',
  name: 'Junie',
  description:
    'JetBrains Junie CLI. The official AI coding agent; reuses JetBrains AI subscription quota and can serve as a "task executor" in Tool mode.',
  icon: '🚀',
  vendor: 'JetBrains',
  officialDoc: 'https://www.jetbrains.com/junie',
  installHint: 'curl -fsSL https://www.jetbrains.com/junie/install.sh | bash, or install from within a JetBrains IDE',

  fingerprint: {
    commandNames: ['junie'],
    versionArgs: ['--version'],
    versionPattern: /junie\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.junie', '~/Library/Application Support/JetBrains/Junie'],
    envVars: ['JETBRAINS_API_KEY', 'JUNIE_API_KEY', 'JETBRAINS_TOKEN'],
    authCheck: {
      cmd: 'junie auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:junie:run-task',
        description:
          'Execute a one-shot text task with the local Junie and return the result (automatically reuses JetBrains AI subscription quota). Suited for tasks like "modify code / analyze text / draft content".',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g. code snippets, file contents, notes)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory for execution (default = current DSH workspace; a JetBrains project is recommended)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'junie run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
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
