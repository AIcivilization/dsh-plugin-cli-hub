/**
 * Ollama Adapter — Tool mode
 *
 * Ollama: local model runtime. Runs locally, no network dependency, no API key.
 *   ollama run <model> "<task>"
 */
import { defineCliAdapter } from '../define';

export const ollamaAdapter = defineCliAdapter({
  id: 'ollama',
  name: 'Ollama',
  description:
    'Ollama local model runtime. Local inference, zero network dependency, zero API key. Can be used as the "local inference executor" in Tool mode, ideal for privacy-sensitive or offline scenarios.',
  icon: '🦙',
  vendor: 'Ollama',
  officialDoc: 'https://ollama.com',
  installHint: 'curl -fsSL https://ollama.com/install.sh | sh, then ollama pull llama3.1',
  login: {
    note: 'Local runtime — no login required. Just make sure the ollama service is running.',
  },

  fingerprint: {
    commandNames: ['ollama', 'ollama-cli'],
    versionArgs: ['--version'],
    versionPattern: /(?:ollama\s+is\s+)?v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.ollama', '/usr/share/ollama'],
    envVars: ['OLLAMA_HOST', 'OLLAMA_ORIGINS', 'OLLAMA_MODELS'],
    // Ollama is a local service with no concept of auth; use list to check whether models are ready
    authCheck: {
      cmd: 'ollama list',
      expectAuthenticated: /^NAME\s+\S+/im,
      expectUnauthenticated: /(no.*model|empty|not.*running|connection refused)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== One-shot Task Execution ========
      {
        dshToolName: 'cli-hub:ollama:run-task',
        description:
          'Run a one-shot text task on local Ollama and return the result (local inference, zero network dependency). Suited for tasks such as "Q&A / text analysis / content drafting / translation"; prefer this tool in privacy-sensitive scenarios.',
        inputSchema: {
          type: 'object',
          required: ['task', 'model'],
          properties: {
            task: { type: 'string', minLength: 2, maxLength: 8000, description: 'Task description to execute' },
            model: {
              type: 'string',
              description: 'Model name (e.g. llama3.1 / qwen2.5 / deepseek-r1 / gemma2; required)',
            },
            context: {
              type: 'string',
              description: 'Additional context/background knowledge (e.g. code snippets, file contents, explanations)',
            },
            host: {
              type: 'string',
              description: 'Ollama service address (e.g. http://localhost:11434; leave empty for default)',
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
