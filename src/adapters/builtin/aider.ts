/**
 * Aider Adapter —— Tool 模式
 *
 * Aider：git-native 编码 Agent，支持与 git 仓库深度协作。
 *   aider --message "<task>" --yes-always
 */
import { defineCliAdapter } from '../define';

export const aiderAdapter = defineCliAdapter({
  id: 'aider',
  name: 'Aider',
  description:
    'Aider git-native 编码 Agent。原生支持 git 提交/回滚/分支管理，能基于现有仓库代码做修改。可作为 Tool 模式的"代码修改器"。',
  icon: '🤝',
  vendor: 'Aider',
  officialDoc: 'https://aider.chat',
  installHint: 'pip install aider-chat，然后 export ANTHROPIC_API_KEY 或 OPENAI_API_KEY',

  fingerprint: {
    commandNames: ['aider'],
    versionArgs: ['--version'],
    versionPattern: /aider\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.aider.conf.yml', '~/.config/aider'],
    envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'AIDER_API_KEY'],
    authCheck: {
      cmd: 'aider --version',
      expectAuthenticated: /aider\s+v?([0-9][\w.+-]*)/i,
      expectUnauthenticated: /(no.*key|missing.*key|please.*set|unauthorized)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:aider:run-task',
        description:
          '用本机 Aider 一次性执行一个编码任务并返回结果（自动复用已配置的 LLM API Key/额度）。Aider 会自动 git commit 修改。适合"修改某文件/重构某段代码/补全测试"等任务。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的编码任务描述' },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            workdir: {
              type: 'string',
              description: '执行工作目录（默认 = 当前 DSH workspace，应当是 git 仓库）',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: '需要让 Aider 编辑的文件列表',
            },
            model: {
              type: 'string',
              description: '模型名（留空使用默认，如 claude-sonnet-4）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template:
            'aider --message "{{task}}" --yes-always --no-pretty --cwd {{workdir}} --model {{model}} {{files}}',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],
  },

  minimumVersion: '0.50.0',
});
