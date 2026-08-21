/**
 * TGPT Adapter —— Tool 模式
 *
 * aandrew-me/tgpt：终端 ChatGPT，默认无需 API Key 即可用（也支持自定义 provider）。
 *   tgpt "<task>"
 */
import { defineCliAdapter } from '../define';

export const tgptAdapter = defineCliAdapter({
  id: 'tgpt',
  name: 'TGPT',
  description:
    'aandrew-me/tgpt 终端 ChatGPT。默认无需 API Key 即可使用（走公开反代 provider），也可配置自定义 provider。适合"快速问答/文本生成/翻译"等任务。',
  icon: '🗣️',
  vendor: 'aandrew-me',
  officialDoc: 'https://github.com/aandrew-me/tgpt',
  installHint: 'curl -fsSL https://github.com/aandrew-me/tgpt/releases/latest/download/install.sh | bash',

  fingerprint: {
    commandNames: ['tgpt'],
    versionArgs: ['--version'],
    versionPattern: /tgpt\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.tgpt'],
    envVars: ['OPENAI_API_KEY', 'TGPT_API_KEY', 'TGPT_PROVIDER'],
    // tgpt 默认无需登录；不强制 authCheck
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:tgpt:run-task',
        description:
          '用本机 tgpt 一次性执行一个文本任务并返回结果（默认无需 API Key）。适合"快速问答/文本生成/翻译/总结"等任务。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            provider: {
              type: 'string',
              description: 'provider 名（如 openai / phind / groq 等，留空使用默认）',
            },
            model: {
              type: 'string',
              description: '模型名（留空使用默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'tgpt --provider {{provider}} --model {{model}} "{{task}}"',
        },
        outputParser: 'stdout-text',
        timeoutMs: 120_000,
        estimatedCredits: 3,
      },
    ],
  },

  minimumVersion: '2.0.0',
});
