/**
 * Paperclip AI CLI Adapter — Tool mode
 *
 * PaperclipAI open-source Agent CLI with multi-model routing.
 *   paperclipai run --json "<task>"
 *
 * Reuses the PaperclipAI platform account quota.
 */
import { defineCliAdapter } from '../define';

export const paperclipaiAdapter = defineCliAdapter({
  id: 'paperclipai',
  name: 'PaperclipAI CLI',
  description:
    'PaperclipAI open-source Agent CLI. Multi-model routing and tool calling; runs complex tasks in Tool mode.',
  icon: '📎',
  vendor: 'PaperclipAI',
  officialDoc: 'https://github.com/paperclip-ai/paperclip-cli',
  installHint: 'npm i -g paperclipai, then paperclipai auth login',

  fingerprint: {
    commandNames: ['paperclipai', 'paperclip', 'paperclip-cli'],
    versionArgs: ['--version'],
    versionPattern: /paperclip(?:ai|[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.paperclipai', '~/.config/paperclip'],
    envVars: ['PAPERCLIP_API_KEY', 'PAPERCLIP_TOKEN'],
    authCheck: {
      cmd: 'paperclipai auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:paperclipai:run-task',
        description: 'Run an Agent task via the PaperclipAI CLI (multi-model routing + tool calling).',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            model: { type: 'string', description: 'Specific model (leave empty for default routing)' },
            tools: { type: 'string', description: 'Allowed tools list (comma-separated, e.g. "bash,fs,web")' },
            workdir: { type: 'string', description: 'Working directory' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'paperclipai run --model {{model}} --tools {{tools}} --cwd {{workdir}} --json "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
