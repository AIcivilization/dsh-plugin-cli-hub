/**
 * Aider Adapter —— Tool mode
 *
 * Aider: git-native coding agent with deep git repository integration.
 *   aider --message "<task>" --yes-always
 */
import { defineCliAdapter } from '../define';

export const aiderAdapter = defineCliAdapter({
  id: 'aider',
  name: 'Aider',
  description:
    'Aider git-native coding agent. Natively supports git commit/rollback/branch management and can make changes based on existing repository code. Usable as a code editor in Tool mode.',
  icon: '🤝',
  vendor: 'Aider',
  officialDoc: 'https://aider.chat',
  installHint: 'pip install aider-chat, then export ANTHROPIC_API_KEY or OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['aider'],
    versionArgs: ['--version'],
    versionPattern: /aider\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.aider.conf.yml', '~/.config/aider'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'AIDER_API_KEY'],
    authCheck: {
      cmd: 'aider --version',
      expectAuthenticated: /aider\s+v?([0-9][\w.+-]*)/i,
      expectUnauthenticated: /(no.*key|missing.*key|please.*set|unauthorized)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== one-shot task execution ========
      {
        dshToolName: 'cli-hub:aider:run-task',
        description:
          'Run a one-shot coding task with the local Aider and return the result (automatically reuses the configured LLM API key/quota). Aider automatically git commits changes. Suited for tasks like editing a file, refactoring a code section, or completing tests.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Description of the coding task to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g., code snippets, file contents, notes)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory for execution (default = current DSH workspace; should be a git repository)',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files for Aider to edit',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default, e.g., claude-sonnet-4)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template:
            'aider --message "{{task}}" --yes-always --no-pretty --cwd {{workdir}} --model {{model}} {{files}}',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],
  },

  minimumVersion: '0.50.0',
});
