/**
 * GitHub Copilot CLI Adapter —— Tool 模式
 *
 * GitHub 官方 CLI 子命令 `gh copilot`（通过 gh 扩展安装）以及独立的 `copilot` 二进制。
 *   copilot suggest "..." --json
 *   copilot explain "..."
 *
 * 复用 GitHub 账户的 Copilot 订阅额度。
 */
import { defineCliAdapter } from '../define';

export const copilotAdapter = defineCliAdapter({
  id: 'copilot',
  name: 'GitHub Copilot CLI',
  description:
    'GitHub Copilot 官方 CLI（gh copilot / copilot）。已订阅 Copilot 的用户可直接复用账户额度，作为代码补全与建议 Tool 使用。',
  icon: '🐙',
  vendor: 'GitHub',
  officialDoc: 'https://docs.github.com/copilot/cli',
  installHint: 'gh extension install github/gh-copilot 或 npm i -g @github/copilot-cli，然后 gh auth login',

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
      // ======== 代码建议 ========
      {
        dshToolName: 'cli-hub:copilot:suggest',
        description:
          '用 Copilot CLI 给出代码建议（"我想用 bash 批量重命名 jpg 文件"→ 给出命令）。复用 GitHub Copilot 订阅额度。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 2, maxLength: 2000, description: '描述想要的代码或命令' },
            language: { type: 'string', description: '目标语言/Shell（sh/js/ts/go/py/rs...）' },
            workdir: { type: 'string', description: '工作目录（默认当前 DSH workspace）' },
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

      // ======== 命令/代码解释 ========
      {
        dshToolName: 'cli-hub:copilot:explain',
        description: '用 Copilot CLI 解释一段命令或代码片段的作用。',
        inputSchema: {
          type: 'object',
          required: ['snippet'],
          properties: {
            snippet: { type: 'string', minLength: 1, maxLength: 4000, description: '要解释的命令/代码' },
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
