/**
 * Devin Desktop CLI Adapter — Tool mode
 *
 * Desktop CLI of Cognition AI Devin (the devin-desktop binary).
 *   devin-desktop run --json "<task>"
 *
 * Reuses your Devin subscription quota.
 */
import { defineCliAdapter } from '../define';

export const devinDesktopAdapter = defineCliAdapter({
  id: 'devin-desktop',
  name: 'Devin Desktop CLI',
  description:
    'Desktop CLI of Cognition AI Devin. Devin subscribers can reuse their account quota directly and use Devin as an autonomous software engineer tool.',
  icon: '🤖',
  vendor: 'Cognition AI',
  officialDoc: 'https://docs.cognition.ai/devin/desktop',
  installHint: '"Install CLI" inside the Devin Desktop app, or download the devin-desktop binary into ~/.codeium/windsurf/bin',

  fingerprint: {
    commandNames: ['devin-desktop', 'devin'],
    versionArgs: ['--version'],
    // Its bin shim is a VS Code-style launcher: executing it (even with --version) opens the
    // Devin desktop app on screen. Never exec-probe; auth falls back to envVars/configPaths.
    probePolicy: 'skip',
    versionPattern: /devin(?:[-\s]desktop)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.codeium/windsurf', '~/Library/Application Support/Devin'],
    envVars: ['DEVIN_API_KEY', 'COGNITION_API_KEY', 'WINDSURF_TOKEN'],
    authCheck: {
      cmd: 'devin-desktop auth status',
      expectAuthenticated: /(valid|ok|active|authenticated|signed in)/i,
      expectUnauthenticated: /(no.*token|not.*signed|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:devin-desktop:run-task',
        description: 'Run an autonomous software engineering task via the Devin Desktop CLI.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description (e.g. "implement a login page")' },
            repo: { type: 'string', description: 'Target repository path (defaults to the current workspace)' },
            maxSteps: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'devin-desktop run --repo {{repo}} --max-steps {{maxSteps}} --json "{{task}}"',
        },
        outputParser: 'stdout-json',
        timeoutMs: 1800_000,
        estimatedCredits: 100,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
