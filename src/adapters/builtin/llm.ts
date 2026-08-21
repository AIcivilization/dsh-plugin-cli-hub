/**
 * llm CLI Adapter —— Tool 模式
 *
 * Simon Willison 的 llm CLI（最受欢迎的 Python AI CLI 之一）。
 *   llm -m gpt-4o "<prompt>" --json
 *
 * 复用 OpenAI / Anthropic / 本地 Ollama 等多种后端额度。
 */
import { defineCliAdapter } from '../define';

export const llmAdapter = defineCliAdapter({
  id: 'llm',
  name: 'llm CLI',
  description:
    'Simon Willison 的 llm CLI。支持 OpenAI/Anthropic/Gemini/Ollama 等多后端路由，是最受欢迎的 Python AI CLI 之一。',
  icon: '🧠',
  vendor: 'Simon Willison',
  officialDoc: 'https://llm.datasette.io',
  installHint: 'pip install llm 或 pipx install llm，然后 llm keys set openai',

  fingerprint: {
    commandNames: ['llm'],
    versionArgs: ['--version'],
    versionPattern: /llm\s*,?\s*version\s*([0-9][\w.+-]*)/i,
    configPaths: ['~/Library/Application Support/io.datasette.llm', '~/.config/io.datasette.llm'],
    envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'],
    authCheck: {
      cmd: 'llm keys list',
      expectAuthenticated: /(openai|anthropic|gemini|google)/i,
      expectUnauthenticated: /(no.*keys|empty)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:llm:prompt',
        description: '用 llm CLI 执行一次 prompt（可指定模型、system、temperature）。复用配置的 API Key。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 16000, description: '用户输入' },
            model: { type: 'string', description: '模型 ID（如 gpt-4o, claude-3-5-sonnet, gemini-1.5-pro）' },
            system: { type: 'string', description: 'System prompt（可选）' },
            temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'llm -m {{model}} --system "{{system}}" -o temperature {{temperature}} "{{prompt}}"',
        },
        outputParser: 'stdout-text',
        timeoutMs: 120_000,
        estimatedCredits: 5,
      },
    ],
  },

  minimumVersion: '0.10.0',
});
