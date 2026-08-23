/**
 * AIChat Adapter —— Tool mode
 *
 * sigoden/aichat: multi-model chat CLI supporting 20+ LLM providers plus roles/MCP.
 *   aichat -m "<model>" --message "<task>"
 */
import { defineCliAdapter } from '../define';

export const aichatAdapter = defineCliAdapter({
  id: 'aichat',
  name: 'AIChat',
  description:
    'sigoden/aichat multi-model chat CLI. Natively supports 20+ LLM providers (OpenAI/Anthropic/Google/DeepSeek/local Ollama, etc.) and can serve as a general-purpose Q&A/text executor in Tool mode.',
  icon: '💬',
  vendor: 'sigoden',
  officialDoc: 'https://github.com/sigoden/aichat',
  installHint: 'cargo install aichat or download a prebuilt binary; the first run guides you through provider config',

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
      // aichat has no native auth status; auth is inferred indirectly by listing configured providers
      cmd: 'aichat --list-models',
      expectAuthenticated: /([a-z][\w-]+)/i,
      expectUnauthenticated: /(no.*model|no.*provider|please.*config|not configured)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== one-shot task execution ========
      {
        dshToolName: 'cli-hub:aichat:run-task',
        description:
          'Run a one-shot text task with the local aichat and return the result (automatically reuses the configured LLM API key/quota). Suited for tasks like Q&A, text analysis, content drafting, and translation.',
        inputSchema: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Description of the task to execute' },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g., code snippets, file contents, notes)',
            },
            model: {
              type: 'string',
              description: 'Model name (e.g., gpt-4o / claude-3.7-sonnet / deepseek-chat / qwen-max)',
            },
            role: {
              type: 'string',
              description: 'aichat role name; leave empty to use the default empty role',
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
