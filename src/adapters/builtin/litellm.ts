/**
 * LiteLLM Adapter — Tool mode
 *
 * BerriAI/LiteLLM: multi-provider proxy that calls 100+ models via a unified OpenAI-compatible protocol.
 *   litellm --model <model> --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const litellmAdapter = defineCliAdapter({
  id: 'litellm',
  name: 'LiteLLM',
  description:
    'BerriAI/LiteLLM multi-provider proxy CLI. Calls 100+ provider models via a unified OpenAI-compatible protocol. Can be used as the "general LLM executor" in Tool mode, making it easy to switch between providers.',
  icon: '🔌',
  vendor: 'BerriAI',
  officialDoc: 'https://docs.litellm.ai',
  installHint: 'pip install litellm, then configure provider environment variables (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY)',

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
    // LiteLLM has no unified auth status; infer indirectly by listing known providers
    authCheck: {
      cmd: 'litellm --model_list',
      expectAuthenticated: /([a-z][\w\/.-]+)/i,
      expectUnauthenticated: /(no.*provider|not.*configured|missing.*key)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:litellm:run-task',
        description:
          'Run a one-shot text task on local LiteLLM and return the result (automatically reuses configured provider API keys/quota). Suited for tasks such as "Q&A / text analysis / content drafting / translation", especially scenarios that require switching between providers/models.',
        inputSchema: {
          type: 'object',
          required: ['task', 'model'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            model: {
              type: 'string',
              description:
                'LiteLLM model name (e.g. gpt-4o / claude-3-7-sonnet / deepseek/deepseek-chat / gemini/gemini-2.0-flash; required)',
            },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g. code snippets, file contents, explanations)',
            },
            apiBase: {
              type: 'string',
              description: 'Custom API base URL (e.g. pointing to a self-hosted LiteLLM proxy; leave empty for the provider default)',
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
