/**
 * Cline Adapter — Tool mode
 *
 * Cline: open-source VS Code + CLI Agent supporting multiple LLM providers.
 *   cline run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const clineAdapter = defineCliAdapter({
  id: 'cline',
  name: 'Cline',
  description:
    'Cline open-source VS Code + CLI Agent. Supports multiple LLM providers including Anthropic/OpenAI/DeepSeek. Can be used as the "task executor" in Tool mode.',
  icon: '🤖',
  vendor: 'Cline',
  officialDoc: 'https://github.com/cline/cline',
  installHint: 'npm i -g @anthropic-ai/cline, then export ANTHROPIC_API_KEY or OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['cline'],
    versionArgs: ['--version'],
    versionPattern: /cline\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.cline', '~/.config/cline'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLINE_API_KEY', 'DEEPSEEK_API_KEY'],
    authCheck: {
      cmd: 'cline auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:cline:run-task',
        description:
          'Run a one-shot text task on local Cline and return the result (automatically reuses configured LLM API keys/quota). Suited for tasks such as "code modification / text analysis / content drafting".',
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
          template: 'cline run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
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
