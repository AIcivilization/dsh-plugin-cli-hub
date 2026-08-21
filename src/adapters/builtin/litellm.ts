/**
 * LiteLLM Adapter —— Tool 模式
 *
 * BerriAI/LiteLLM：多 provider 代理，统一 OpenAI 兼容协议调用 100+ 模型。
 *   litellm --model <model> --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const litellmAdapter = defineCliAdapter({
  id: 'litellm',
  name: 'LiteLLM',
  description:
    'BerriAI/LiteLLM 多 provider 代理 CLI。统一 OpenAI 兼容协议调用 100+ provider 模型，可作为 Tool 模式的"通用 LLM 执行器"使用，便于在不同 provider 之间切换。',
  icon: '🔌',
  vendor: 'BerriAI',
  officialDoc: 'https://docs.litellm.ai',
  installHint: 'pip install litellm，然后配置 provider 环境变量（如 OPENAI_API_KEY / ANTHROPIC_API_KEY）',

  fingerprint: {
    commandNames: ['litellm'],
    versionArgs: ['--version'],
    versionPattern: /litellm\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.litellm', '~/.config/litellm'],
    envVars: [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'GEMINI_API_KEY',
      'LITELLM_API_KEY',
      'LITELLM_PROXY_URL',
    ],
    // LiteLLM 无统一 auth status；通过列出已知 provider 间接判断
    authCheck: {
      cmd: 'litellm --model_list',
      expectAuthenticated: /([a-z][\w\/.-]+)/i,
      expectUnauthenticated: /(no.*provider|not.*configured|missing.*key)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:litellm:run-task',
        description:
          '用本机 LiteLLM 一次性执行一个文本任务并返回结果（自动复用已配置的 provider API Key/额度）。适合"问答/分析文本/草拟内容/翻译"等任务，特别适合需要在不同 provider/model 间切换的场景。',
        inputSchema: {
          type: 'object',
          required: ['task', 'model'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            model: {
              type: 'string',
              description:
                'LiteLLM 模型名（如 gpt-4o / claude-3-7-sonnet / deepseek/deepseek-chat / gemini/gemini-2.0-flash，必填）',
            },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            apiBase: {
              type: 'string',
              description: '自定义 API base URL（如指向自建 LiteLLM proxy，留空使用 provider 默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'litellm --model {{model}} --message "{{task}}" --api_base {{apiBase}}',
        },
        outputParser: 'stdout-text',
        timeoutMs: 300_000,
        estimatedCredits: 10,
      },
    ],
  },

  minimumVersion: '1.40.0',
});
