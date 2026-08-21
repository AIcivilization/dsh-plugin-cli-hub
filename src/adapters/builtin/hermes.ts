/**
 * Hermes CLI Adapter —— Tool 模式 + Agent 模式预留
 *
 * NousResearch Hermes 系列开源 CLI（含 hermes-acp ACP 协议变体）。
 *   hermes chat --json "<prompt>"
 *   hermes-acp serve --stdio   ← Agent 模式 V2 再接入
 *
 * 复用本地部署的 Hermes 模型或第三方网关额度。
 */
import { defineCliAdapter } from '../define';

export const hermesAdapter = defineCliAdapter({
  id: 'hermes',
  name: 'Hermes CLI',
  description:
    'NousResearch Hermes 系列 CLI（hermes / hermes-acp）。开源模型 + ACP 协议支持，可作 Tool 模式调用或子 Agent。',
  icon: '🪽',
  vendor: 'NousResearch',
  officialDoc: 'https://github.com/NousResearch/hermes-cli',
  installHint: 'pip install hermes-cli 或 npm i -g @nous/hermes-cli，然后 export HERMES_API_KEY=...',

  fingerprint: {
    commandNames: ['hermes', 'hermes-acp', 'hermes-cli'],
    versionArgs: ['--version'],
    versionPattern: /hermes(?:[-\s]acp|\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.hermes', '~/.config/hermes'],
    envVars: ['HERMES_API_KEY', 'NOUS_API_KEY', 'OPENAI_API_KEY'],
    authCheck: {
      cmd: 'hermes auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:hermes:chat',
        description:
          '用 Hermes CLI 做一轮 chat。适合需要 Nous Hermes 模型推理能力的任务（推理/Function Call）。复用本地或第三方网关额度。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 16000, description: '用户输入' },
            system: { type: 'string', description: 'System prompt（可选）' },
            model: { type: 'string', description: '模型名（如 Hermes-3-Llama-4-70B，留空用默认）' },
            temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'hermes chat --model {{model}} --temperature {{temperature}} --system "{{system}}" --json "{{prompt}}"',
        },
        outputParser: 'stdout-json',
        timeoutMs: 120_000,
        estimatedCredits: 5,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
