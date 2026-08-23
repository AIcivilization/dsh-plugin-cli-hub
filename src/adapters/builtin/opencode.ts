/**
 * OpenCode Adapter — Tool mode
 *
 * OpenCode: terminal AI Agent supporting 75+ providers.
 *   opencode run --task "<task>"
 */
import { defineCliAdapter } from '../define';

export const opencodeAdapter = defineCliAdapter({
  id: 'opencode',
  name: 'OpenCode',
  description:
    'OpenCode terminal AI Agent. Natively supports 75+ providers (Anthropic/OpenAI/DeepSeek/Google/xAI, etc.). Can be used as the "task executor" in Tool mode.',
  icon: '✨',
  vendor: 'OpenCode',
  officialDoc: 'https://github.com/sst/opencode',
  installHint: 'npm i -g opencode, then export ANTHROPIC_API_KEY or OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['opencode', 'opencode-cli', 'opencode-agent'],
    versionArgs: ['--version'],
    versionPattern: /opencode\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.opencode', '~/.config/opencode'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY'],
    authCheck: {
      cmd: 'opencode auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:opencode:run-task',
        description:
          'Run a one-shot text task on local OpenCode and return the result (automatically reuses configured LLM API keys/quota). Suited for tasks such as "code modification / text analysis / content drafting".',
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
            provider: {
              type: 'string',
              description: 'Provider name (e.g. anthropic/openai/deepseek/xai; leave empty for default)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template:
            'opencode run --task "{{task}}" --cwd {{workdir}} --model {{model}} --provider {{provider}} --json',
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
