/**
 * Continue Adapter — Tool mode
 *
 * Continue.dev CLI: open-source AI coding assistant supporting multiple LLM providers.
 *   continue run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const continueAdapter = defineCliAdapter({
  id: 'continue',
  name: 'Continue',
  description:
    'Continue.dev open-source CLI. Supports multiple LLM providers including Anthropic/OpenAI/DeepSeek. Can be used as the "task executor" in Tool mode.',
  icon: '➡️',
  vendor: 'ContinueDev',
  officialDoc: 'https://www.continue.dev',
  installHint: 'npm i -g @continuedev/cli or pip install continuedev, then export ANTHROPIC_API_KEY or OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['continue', 'continuedev'],
    versionArgs: ['--version'],
    versionPattern: /continue(?:dev)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.continue', '~/.config/continue'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CONTINUE_API_KEY', 'DEEPSEEK_API_KEY'],
    authCheck: {
      cmd: 'continue auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:continue:run-task',
        description:
          'Run a one-shot text task on local Continue CLI and return the result (automatically reuses configured LLM API keys/quota). Suited for tasks such as "code modification / text analysis / content drafting".',
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
          template: 'continue run --task "{{task}}" --cwd {{workdir}} --model {{model}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 18,
      },
    ],
  },

  minimumVersion: '0.9.0',
});
