/**
 * Goose Adapter — Tool mode
 *
 * Goose: terminal AI Agent by Block.
 *   goose run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const gooseAdapter = defineCliAdapter({
  id: 'goose',
  name: 'Goose',
  description:
    'Block Goose terminal AI Agent. Natively supports multiple LLM providers and MCP tools. Can be used as the "task executor" in Tool mode.',
  icon: '🪿',
  vendor: 'Block',
  officialDoc: 'https://github.com/block/goose',
  installHint: 'curl -fsSL https://github.com/block/goose/releases/latest/download/install.sh | bash',

  fingerprint: {
    commandNames: ['goose'],
    versionArgs: ['--version'],
    versionPattern: /goose\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/goose', '~/Library/Application Support/Goose'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOSE_API_KEY', 'DATABRICKS_TOKEN'],
    authCheck: {
      cmd: 'goose auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:goose:run-task',
        description:
          'Run a one-shot text task on local Goose and return the result (automatically reuses configured LLM API keys/quota). Suited for tasks such as "code modification / text analysis / content drafting".',
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
              description: 'Model name (leave empty for default)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'goose run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.10.0',
});
