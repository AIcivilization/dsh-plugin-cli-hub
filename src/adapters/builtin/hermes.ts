/**
 * Hermes CLI Adapter —— Tool mode + Agent mode reserved
 *
 * NousResearch Hermes family of open-source CLIs (including the hermes-acp ACP protocol variant).
 *   hermes chat --json "<prompt>"
 *   hermes-acp serve --stdio   ← Agent mode to be integrated in V2
 *
 * Reuses locally deployed Hermes models or third-party gateway quota.
 */
import { defineCliAdapter } from '../define';

export const hermesAdapter = defineCliAdapter({
  id: 'hermes',
  name: 'Hermes CLI',
  description:
    'NousResearch Hermes family CLIs (hermes / hermes-acp). Open-source models + ACP protocol support; usable as a Tool mode call or a sub-Agent.',
  icon: '🪽',
  vendor: 'NousResearch',
  officialDoc: 'https://github.com/NousResearch/hermes-cli',
  installHint: 'pip install hermes-cli or npm i -g @nous/hermes-cli, then export HERMES_API_KEY=...',

  fingerprint: {
    commandNames: ['hermes', 'hermes-acp', 'hermes-cli'],
    versionArgs: ['--version'],
    versionPattern: /hermes(?:[-\s]acp|\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.hermes', '~/.config/hermes'],
    envVars: ['HERMES_API_KEY', 'NOUS_API_KEY', 'OPENAI_API_KEY'],
    authCheck: {
      cmd: 'hermes auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:hermes:chat',
        description:
          'Run one round of chat with the Hermes CLI. Suited for tasks that need Nous Hermes model reasoning (reasoning/function calling). Reuses local or third-party gateway quota.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 16000, description: 'User input' },
            system: { type: 'string', description: 'System prompt (optional)' },
            model: { type: 'string', description: 'Model name (e.g. Hermes-3-Llama-4-70B; leave empty for default)' },
            temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'hermes chat --model {{model}} --temperature {{temperature}} --system "{{system}}" --json "{{prompt}}"',
        },
        outputParser: 'stdout-json',
        timeoutMs: 120_000,
        estimatedCredits: 5,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
