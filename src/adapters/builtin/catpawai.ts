/**
 * CatpawAI CLI Adapter —— Tool mode
 *
 * CatpawAI open-source AI agent CLI (based on the ACP protocol).
 *   catpawai run --json "<task>"
 *
 * Reuses CatpawAI platform account quota or local models.
 */
import { defineCliAdapter } from '../define';

export const catpawaiAdapter = defineCliAdapter({
  id: 'catpawai',
  name: 'CatpawAI CLI',
  description:
    'CatpawAI open-source AI agent CLI (based on the ACP protocol). Supports tool calls and multi-step reasoning; usable in Tool mode.',
  icon: '🐾',
  vendor: 'CatpawAI',
  officialDoc: 'https://github.com/catpawai/catpawai-cli',
  installHint: 'npm i -g catpawai or pip install catpawai, then catpawai auth login',

  fingerprint: {
    commandNames: ['catpawai', 'catpaw', 'catpawai-cli'],
    versionArgs: ['--version'],
    versionPattern: /catpaw(?:ai|[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.catpawai', '~/.config/catpawai'],
    envVars: ['CATPAWAI_API_KEY', 'CATPAWAI_TOKEN', 'ACP_API_KEY'],
    authCheck: {
      cmd: 'catpawai auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:catpawai:run-task',
        description: 'Run an agent task with CatpawAI CLI (tool calls + multi-step reasoning).',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description' },
            tools: { type: 'string', description: 'Allowed tools list (comma-separated)' },
            model: { type: 'string', description: 'Model to use (leave empty for default)' },
            workdir: { type: 'string', description: 'Working directory' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'catpawai run --model {{model}} --tools {{tools}} --cwd {{workdir}} --json "{{task}}"',
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
