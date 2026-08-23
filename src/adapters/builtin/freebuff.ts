/**
 * FreeBuff CLI Adapter — Tool mode
 *
 * FreeBuff open-source security/pentest AI Agent CLI.
 *   freebuff run --json "<task>"
 *
 * Reuses the FreeBuff platform account quota.
 */
import { defineCliAdapter } from '../define';

export const freebuffAdapter = defineCliAdapter({
  id: 'freebuff',
  name: 'FreeBuff CLI',
  description:
    'FreeBuff open-source security/pentest AI Agent CLI. Runs security analysis, vulnerability scanning and code audit tasks in Tool mode.',
  icon: '🛡️',
  vendor: 'FreeBuff',
  officialDoc: 'https://github.com/freebuff/freebuff-cli',
  installHint: 'npm i -g freebuff, then freebuff auth login',

  fingerprint: {
    commandNames: ['freebuff', 'freebuff-cli'],
    versionArgs: ['--version'],
    versionPattern: /freebuff(?:[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.freebuff', '~/.config/freebuff'],
    envVars: ['FREEBUFF_API_KEY', 'FREEBUFF_TOKEN'],
    authCheck: {
      cmd: 'freebuff auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:freebuff:scan',
        description: 'Run security scanning / vulnerability analysis tasks via the FreeBuff CLI.',
        inputSchema: {
          type: 'object',
          required: ['target'],
          properties: {
            target: { type: 'string', minLength: 1, maxLength: 2000, description: 'Scan target (URL / IP / file path)' },
            mode: {
              type: 'string',
              enum: ['quick', 'deep', 'audit'],
              default: 'quick',
              description: 'Scan mode: quick (fast) / deep (thorough) / audit (code audit)',
            },
            workdir: { type: 'string', description: 'Working directory' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'freebuff run --mode {{mode}} --cwd {{workdir}} --json "{{target}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 30,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
