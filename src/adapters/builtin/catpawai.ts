/**
 * CatpawAI CLI Adapter —— Tool 模式
 *
 * CatpawAI 开源 AI Agent CLI（基于 ACP 协议）。
 *   catpawai run --json "<task>"
 *
 * 复用 CatpawAI 平台账户额度或本地模型。
 */
import { defineCliAdapter } from '../define';

export const catpawaiAdapter = defineCliAdapter({
  id: 'catpawai',
  name: 'CatpawAI CLI',
  description:
    'CatpawAI 开源 AI Agent CLI（基于 ACP 协议）。支持工具调用与多步推理，可作 Tool 模式使用。',
  icon: '🐾',
  vendor: 'CatpawAI',
  officialDoc: 'https://github.com/catpawai/catpawai-cli',
  installHint: 'npm i -g catpawai 或 pip install catpawai，然后 catpawai auth login',

  fingerprint: {
    commandNames: ['catpawai', 'catpaw', 'catpawai-cli'],
    versionArgs: ['--version'],
    versionPattern: /catpaw(?:ai|[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.catpawai', '~/.config/catpawai'],
    envVars: ['CATPAWAI_API_KEY', 'CATPAWAI_TOKEN', 'ACP_API_KEY'],
    authCheck: {
      cmd: 'catpawai auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:catpawai:run-task',
        description: '用 CatpawAI CLI 执行一个 Agent 任务（工具调用 + 多步推理）。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '任务描述' },
            tools: { type: 'string', description: '允许工具列表（逗号分隔）' },
            model: { type: 'string', description: '指定模型（留空用默认）' },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'catpawai run --model {{model}} --tools {{tools}} --cwd {{workdir}} --json "{{task}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 20,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
