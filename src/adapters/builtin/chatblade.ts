/**
 * chatblade CLI Adapter — Tool mode
 *
 * chatblade: open-source ChatGPT terminal CLI centered on prompt templates and piped input.
 *   chatblade -p "<prompt>" --json
 *
 * Reuses the OpenAI API key.
 */
import { defineCliAdapter } from '../define';

export const chatbladeAdapter = defineCliAdapter({
  id: 'chatblade',
  name: 'chatblade CLI',
  description:
    'Open-source ChatGPT terminal CLI. Prompt templates, piped input and session history; suited for one-shot prompt execution.',
  icon: '🗡️',
  vendor: 'Open Source',
  officialDoc: 'https://github.com/npiv/chatblade',
  installHint: 'pip install chatblade or pipx install chatblade, then chatblade --config set openai_api_key ...',

  fingerprint: {
    commandNames: ['chatblade'],
    versionArgs: ['--version'],
    versionPattern: /chatblade[,\s]+v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/chatblade', '~/.chatblade'],
    envVars: ['OPENAI_API_KEY'],
    authCheck: {
      cmd: 'chatblade --version',
      expectAuthenticated: /chatblade/i,
      expectUnauthenticated: /no.*api.*key/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:chatblade:prompt',
        description: 'Run a prompt via the chatblade CLI (piped input, prompt templates supported).',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 8000, description: 'User input' },
            model: { type: 'string', description: 'OpenAI model (e.g. gpt-4o, gpt-4o-mini)' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'chatblade -p "{{prompt}}" -m {{model}}',
        },
        outputParser: 'stdout-text',
        timeoutMs: 60_000,
        estimatedCredits: 5,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
