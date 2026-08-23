/**
 * gptme CLI Adapter — Tool mode
 *
 * Erik Bjäreholt's gptme CLI: terminal AI assistant with tool calling + file read/write + code execution.
 *   gptme exec --json "<task>"
 *
 * Reuses OpenAI / Anthropic / local model quota.
 */
import { defineCliAdapter } from '../define';

export const gptmeAdapter = defineCliAdapter({
  id: 'gptme',
  name: 'gptme CLI',
  description:
    'Erik Bjäreholt\'s gptme CLI. Terminal AI assistant with tool calling, file read/write and code execution; runs tasks in Tool mode.',
  icon: '🤖',
  vendor: 'Erik Bjäreholt',
  officialDoc: 'https://github.com/ErikBjare/gptme',
  installHint: 'pip install gptme or pipx install gptme, then run gptme --config set api_key ...',

  fingerprint: {
    commandNames: ['gptme'],
    versionArgs: ['--version'],
    versionPattern: /gptme[,\s]+version\s*([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/gptme', '~/.gptme'],
    envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    authCheck: {
      cmd: 'gptme --version',
      expectAuthenticated: /gptme/i, // gptme does not enforce auth; usable once installed (actual task runs fail without a key)
      expectUnauthenticated: /command not found/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:gptme:exec',
        description: 'Run an Agent task via the gptme CLI (tool calling + file read/write + code execution).',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            model: { type: 'string', description: 'Model ID (e.g. gpt-4o, claude-3-5-sonnet)' },
            workdir: { type: 'string', description: 'Working directory' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'gptme --non-interactive --model {{model}} --cwd {{workdir}} "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 15,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
