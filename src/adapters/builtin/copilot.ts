/**
 * GitHub Copilot CLI Adapter —— Tool mode
 *
 * GitHub's official CLI subcommand `gh copilot` (installed via a gh extension) and the standalone `copilot` binary.
 *   copilot suggest "..." --json
 *   copilot explain "..."
 *
 * Reuses the Copilot subscription quota of the GitHub account.
 */
import { defineCliAdapter } from '../define';

export const copilotAdapter = defineCliAdapter({
  id: 'copilot',
  name: 'GitHub Copilot CLI',
  description:
    'The official GitHub Copilot CLI (gh copilot / copilot). Users with a Copilot subscription can directly reuse their account quota and use it as a code completion and suggestion tool.',
  icon: '🐙',
  vendor: 'GitHub',
  officialDoc: 'https://docs.github.com/copilot/cli',
  installHint: 'gh extension install github/gh-copilot or npm i -g @github/copilot-cli, then gh auth login',

  fingerprint: {
    commandNames: ['copilot', 'gh-copilot'],
    versionArgs: ['--version'],
    versionPattern: /(?:copilot|gh[-\s]copilot)\s*(?:cli\s*)?v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/gh', '~/.config/copilot', '~/Library/Application Support/gh'],
    envVars: ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_TOKEN'],
    authCheck: {
      cmd: 'gh auth status',
      expectAuthenticated: /(logged in|token.*valid|authenticated|active)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*token|please.*login)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== Code suggestion ========
      {
        dshToolName: 'cli-hub:copilot:suggest',
        description:
          'Get code suggestions from Copilot CLI ("I want to batch rename jpg files with bash" → returns a command). Reuses the GitHub Copilot subscription quota.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 2, maxLength: 2000, description: 'Describe the code or command you want' },
            language: { type: 'string', description: 'Target language/Shell (sh/js/ts/go/py/rs...)' },
            workdir: { type: 'string', description: 'Working directory (defaults to the current DSH workspace)' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'copilot',
          args: [
            'suggest',
            { var: 'prompt' },
            { flag: '--language', var: 'language' },
            '--json',
          ],
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 60_000,
        estimatedCredits: 2,
      },

      // ======== Command/code explanation ========
      {
        dshToolName: 'cli-hub:copilot:explain',
        description: 'Use Copilot CLI to explain what a command or code snippet does.',
        inputSchema: {
          type: 'object',
          required: ['snippet'],
          properties: {
            snippet: { type: 'string', minLength: 1, maxLength: 4000, description: 'The command/code to explain' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'copilot',
          args: [
            'explain',
            { var: 'snippet' },
            '--json',
          ],
        },
        outputParser: 'stdout-json',
        timeoutMs: 60_000,
        estimatedCredits: 2,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
