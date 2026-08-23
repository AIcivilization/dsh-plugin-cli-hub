/**
 * smol AI CLI Adapter — Tool mode
 *
 * smol-ai/smol-developer family CLI: an early open-source AI software engineer, centered on the "PM → code" flow.
 *   smol --prompt "<task>" --json
 *
 * Reuses the OpenAI API key.
 */
import { defineCliAdapter } from '../define';

export const smolAdapter = defineCliAdapter({
  id: 'smol',
  name: 'smol Developer CLI',
  description:
    'smol-ai/smol-developer, an early open-source AI software engineer CLI. Centered on the "PM → code" flow; usable in Tool mode.',
  icon: '🤏',
  vendor: 'smol-ai',
  officialDoc: 'https://github.com/smol-ai/smol-developer',
  installHint: 'npm i -g @smol/cli or pip install smol-developer, then export OPENAI_API_KEY=...',

  fingerprint: {
    commandNames: ['smol', 'smol-developer', 'smol-cli'],
    versionArgs: ['--version'],
    versionPattern: /smol(?:[-\s]developer)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.smol', '~/.config/smol'],
    envVars: ['OPENAI_API_KEY'],
    authCheck: {
      cmd: 'smol --version',
      expectAuthenticated: /smol/i,
      expectUnauthenticated: /no.*api.*key/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:smol:develop',
        description: 'Run a "PM → code" task via the smol CLI (takes a requirement description, outputs code).',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 2, maxLength: 8000, description: 'Requirement description (PM-style)' },
            model: { type: 'string', description: 'OpenAI model (e.g. gpt-4o)' },
            workdir: { type: 'string', description: 'Working directory' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'smol --prompt "{{prompt}}" --model {{model}} --cwd {{workdir}} --json',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 25,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
