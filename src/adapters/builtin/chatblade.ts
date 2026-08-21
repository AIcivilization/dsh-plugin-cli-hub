/**
 * chatblade CLI Adapter —— Tool 模式
 *
 * chatblade：开源的 ChatGPT 终端 CLI，主打 prompt 模板和管道式输入。
 *   chatblade -p "<prompt>" --json
 *
 * 复用 OpenAI API Key。
 */
import { defineCliAdapter } from '../define';

export const chatbladeAdapter = defineCliAdapter({
  id: 'chatblade',
  name: 'chatblade CLI',
  description:
    '开源 ChatGPT 终端 CLI。支持 prompt 模板、管道输入、会话历史。适合一次性 prompt 执行。',
  icon: '🗡️',
  vendor: 'Open Source',
  officialDoc: 'https://github.com/npiv/chatblade',
  installHint: 'pip install chatblade 或 pipx install chatblade，然后 chatblade --config set openai_api_key ...',

  fingerprint: {
    commandNames: ['chatblade'],
    versionArgs: ['--version'],
    versionPattern: /chatblade[,\s]+v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/chatblade', '~/.chatblade'],
    envVars: ['OPENAI_API_KEY'],
    authCheck: {
      cmd: 'chatblade --version',
      expectAuthenticated: /chatblade/i,
      expectUnauthenticated: /no.*api.*key/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:chatblade:prompt',
        description: '用 chatblade CLI 执行一次 prompt（管道式输入，支持 prompt 模板）。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 8000, description: '用户输入' },
            model: { type: 'string', description: 'OpenAI 模型（如 gpt-4o, gpt-4o-mini）' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'chatblade -p "{{prompt}}" -m {{model}}',
        },
        outputParser: 'stdout-text',
        timeoutMs: 60_000,
        estimatedCredits: 5,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
