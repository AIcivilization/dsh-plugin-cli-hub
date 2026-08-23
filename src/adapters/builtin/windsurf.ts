/**
 * Windsurf Adapter — Tool mode
 *
 * Windsurf/Devin Desktop CLI: AI coding Agent by Codeium.
 *   windsurf run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const windsurfAdapter = defineCliAdapter({
  id: 'windsurf',
  name: 'Windsurf',
  description:
    'Windsurf/Devin Desktop CLI (by Codeium). AI coding Agent that reuses the Codeium subscription quota; can be used as the "task executor" in Tool mode.',
  icon: '🏄',
  vendor: 'Codeium',
  officialDoc: 'https://docs.windsurf.com',
  installHint: 'curl -fsSL https://windsurf.com/install.sh | bash, or install within the Windsurf IDE',

  fingerprint: {
    commandNames: ['windsurf', 'windsurf-cli', 'devin-desktop'],
    versionArgs: ['--version'],
    versionPattern: /windsurf\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.windsurf', '~/Library/Application Support/Windsurf'],
    envVars: ['WINDSURF_API_KEY', 'CODEIUM_API_KEY', 'WINDSURF_TOKEN'],
    authCheck: {
      cmd: 'windsurf auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:windsurf:run-task',
        description:
          'Run a one-shot text task on local Windsurf and return the result (automatically reuses the Codeium subscription quota). Suited for tasks such as "code modification / text analysis / content drafting".',
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
              description: 'Working directory for execution (default = current DSH workspace)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default, e.g. windsurf-default / gpt-4o / claude-3.7-sonnet)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'windsurf run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '1.0.0',
});
