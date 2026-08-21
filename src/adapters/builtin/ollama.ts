/**
 * Ollama Adapter —— Tool 模式
 *
 * Ollama：本地模型运行时。本机执行，无网络依赖、无 API Key。
 *   ollama run <model> "<task>"
 */
import { defineCliAdapter } from '../define';

export const ollamaAdapter = defineCliAdapter({
  id: 'ollama',
  name: 'Ollama',
  description:
    'Ollama 本地模型运行时。本机推理、零网络依赖、零 API Key。可作为 Tool 模式的"本地推理执行器"使用，适合隐私敏感或离线场景。',
  icon: '🦙',
  vendor: 'Ollama',
  officialDoc: 'https://ollama.com',
  installHint: 'curl -fsSL https://ollama.com/install.sh | sh，然后 ollama pull llama3.1',

  fingerprint: {
    commandNames: ['ollama'],
    versionArgs: ['--version'],
    versionPattern: /(?:ollama\s+is\s+)?v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.ollama', '/usr/share/ollama'],
    envVars: ['OLLAMA_HOST', 'OLLAMA_ORIGINS', 'OLLAMA_MODELS'],
    // Ollama 是本地服务，没有 auth 概念；通过 list 检查模型是否就绪
    authCheck: {
      cmd: 'ollama list',
      expectAuthenticated: /^NAME\s+\S+/im,
      expectUnauthenticated: /(no.*model|empty|not.*running|connection refused)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:ollama:run-task',
        description:
          '用本机 Ollama 一次性执行一个文本任务并返回结果（本机推理，零网络依赖）。适合"问答/分析文本/草拟内容/翻译"等任务；隐私敏感场景应优先使用本工具。',
        inputSchema: {
          type: 'object',
          required: ['task', 'model'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            model: {
              type: 'string',
              description: '模型名（如 llama3.1 / qwen2.5 / deepseek-r1 / gemma2 等，必填）',
            },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            host: {
              type: 'string',
              description: 'Ollama 服务地址（如 http://localhost:11434，留空使用默认）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'ollama run {{model}} "{{task}}"',
        },
        outputParser: 'stdout-text',
        timeoutMs: 300_000,
        estimatedCredits: 1,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
