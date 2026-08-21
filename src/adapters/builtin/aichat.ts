/**
 * AIChat Adapter —— Tool 模式
 *
 * sigoden/aichat：多模型聊天 CLI，支持 20+ LLM provider 与角色/MCP。
 *   aichat -m "<model>" --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const aichatAdapter = defineCliAdapter({
  id: 'aichat',
  name: 'AIChat',
  description:
    'sigoden/aichat 多模型聊天 CLI。原生支持 20+ LLM provider（OpenAI/Anthropic/Google/DeepSeek/本地 Ollama 等），可作为 Tool 模式的"通用问答/文本执行器"使用。',
  icon: '💬',
  vendor: 'sigoden',
  officialDoc: 'https://github.com/sigoden/aichat',
  installHint: 'cargo install aichat 或下载预编译二进制；首次运行会引导配置 provider',

  fingerprint: {
    commandNames: ['aichat'],
    versionArgs: ['--version'],
    versionPattern: /aichat\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/aichat', '~/.aichat'],
    envVars: [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'GEMINI_API_KEY',
      'OLLAMA_HOST',
    ],
    authCheck: {
      // aichat 没有原生 auth status；通过列出已配置 provider 来间接判断
      cmd: 'aichat --list-models',
      expectAuthenticated: /([a-z][\w-]+)/i,
      expectUnauthenticated: /(no.*model|no.*provider|please.*config|not configured)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:aichat:run-task',
        description:
          '用本机 aichat 一次性执行一个文本任务并返回结果（自动复用已配置的 LLM API Key/额度）。适合"问答/分析文本/草拟内容/翻译"等任务。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            model: {
              type: 'string',
              description: '模型名（如 gpt-4o / claude-3.7-sonnet / deepseek-chat / qwen-max）',
            },
            role: {
              type: 'string',
              description: 'aichat 角色（role）名，留空使用默认空角色',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'aichat -m {{model}} --role {{role}} --message "{{task}}"',
        },
        outputParser: 'stdout-text',
        timeoutMs: 300_000,
        estimatedCredits: 10,
      },
    ],
  },

  minimumVersion: '0.20.0',
});
