/**
 * TGPT Adapter — Tool mode
 *
 * aandrew-me/tgpt: terminal ChatGPT, usable without an API key by default (custom providers also supported).
 *   tgpt "<task>"
 */
import { defineCliAdapter } from '../define';

export const tgptAdapter = defineCliAdapter({
  id: 'tgpt',
  name: 'TGPT',
  description:
    'aandrew-me/tgpt terminal ChatGPT. Usable without an API key by default (via public reverse-proxy providers); custom providers configurable too. Suited for quick Q&A / text generation / translation tasks.',
  icon: '🗣️',
  vendor: 'aandrew-me',
  officialDoc: 'https://github.com/aandrew-me/tgpt',
  installHint: 'curl -fsSL https://github.com/aandrew-me/tgpt/releases/latest/download/install.sh | bash',

  fingerprint: {
    commandNames: ['tgpt'],
    versionArgs: ['--version'],
    versionPattern: /tgpt\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.tgpt'],
    envVars: ['OPENAI_API_KEY', 'TGPT_API_KEY', 'TGPT_PROVIDER'],
    // tgpt requires no login by default; no mandatory authCheck
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:tgpt:run-task',
        description:
          'Run a one-shot text task on local tgpt and return the result (no API key needed by default). Suited for quick Q&A / text generation / translation / summarization tasks.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g. code snippets, file contents, explanations)',
            },
            provider: {
              type: 'string',
              description: 'Provider name (e.g. openai / phind / groq; leave empty for default)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default)',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'tgpt --provider {{provider}} --model {{model}} "{{task}}"',
        },
        outputParser: 'stdout-text',
        timeoutMs: 120_000,
        estimatedCredits: 3,
      },
    ],
  },

  minimumVersion: '2.0.0',
});
