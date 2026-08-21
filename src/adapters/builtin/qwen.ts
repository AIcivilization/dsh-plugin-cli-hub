/**
 * Qwen CLI Adapter —— Tool 模式
 *
 * Alibaba Qwen CLI：阿里通义千问官方 CLI，复用 DashScope 账户额度。
 *   qwen --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const qwenAdapter = defineCliAdapter({
  id: 'qwen',
  name: 'Qwen CLI',
  description:
    'Alibaba Qwen CLI。已订阅 DashScope/通义千问的用户可直接复用 API 额度，作为一次性任务执行器使用。中文场景表现强，适合"写一段代码/分析文本/草拟内容"等短平快任务。',
  icon: '🌟',
  vendor: 'Alibaba',
  officialDoc: 'https://github.com/QwenLM/qwen-cli',
  installHint: 'npm i -g @qwen/qwen-cli，然后 export DASHSCOPE_API_KEY=sk-...',

  fingerprint: {
    commandNames: ['qwen', 'qwen-cli'],
    versionArgs: ['--version'],
    versionPattern: /qwen(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.qwen', '~/.config/qwen'],
    envVars: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'ALIYUN_API_KEY'],
    authCheck: {
      cmd: 'qwen auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 一次性任务执行 ========
      {
        dshToolName: 'cli-hub:qwen:run-task',
        description:
          '用本机 Qwen CLI 一次性执行一个文本任务并返回结果（自动复用已登录的 DashScope API Key/额度）。适合"让 Qwen 写一段代码/分析一段文本/草拟内容"等短平快任务，中文场景表现强。',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: '要执行的任务描述' },
            context: {
              type: 'string',
              description: '附加上下文/背景知识（如代码片段、文件内容、说明）',
            },
            workdir: {
              type: 'string',
              description: '执行工作目录（默认 = 当前 DSH workspace）',
            },
            model: {
              type: 'string',
              description: '模型名（留空使用默认，如 qwen-max / qwen3-coder-plus / qwen2.5-72b-instruct）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'qwen --message "{{task}}" --model {{model}} --cwd {{workdir}}',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-text',
        timeoutMs: 600_000,
        estimatedCredits: 15,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
