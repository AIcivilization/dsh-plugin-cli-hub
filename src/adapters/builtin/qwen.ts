/**
 * Qwen CLI Adapter —— Tool mode
 *
 * Alibaba Qwen CLI: Alibaba Tongyi Qianwen's official CLI; reuses the DashScope account quota.
 *   qwen --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const qwenAdapter = defineCliAdapter({
  id: 'qwen',
  name: 'Qwen CLI',
  description:
    'Alibaba Qwen CLI. Users with a DashScope/Tongyi Qianwen subscription can directly reuse their API quota and use it as a one-shot task executor. Strong performance in Chinese-language scenarios; ideal for short, quick tasks like "write a piece of code / analyze text / draft content".',
  icon: '🌟',
  vendor: 'Alibaba',
  officialDoc: 'https://github.com/QwenLM/qwen-cli',
  installHint: 'npm i -g @qwen/qwen-cli, then export DASHSCOPE_API_KEY=sk-...',

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
      // ======== One-shot task execution ========
      {
        dshToolName: 'cli-hub:qwen:run-task',
        description:
          'Execute a one-shot text task with the local Qwen CLI and return the result (automatically reuses the logged-in DashScope API Key/quota). Ideal for short, quick tasks like "have Qwen write a piece of code / analyze a piece of text / draft content"; strong performance in Chinese-language scenarios.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g., code snippets, file contents, notes)',
            },
            workdir: {
              type: 'string',
              description: 'Working directory for execution (default = current DSH workspace)',
            },
            model: {
              type: 'string',
              description: 'Model name (leave empty for default, e.g., qwen-max / qwen3-coder-plus / qwen2.5-72b-instruct)',
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
