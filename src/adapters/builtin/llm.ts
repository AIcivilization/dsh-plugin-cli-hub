/**
 * llm CLI Adapter —— Tool mode
 *
 * Simon Willison's llm CLI (one of the most popular Python AI CLIs).
 *   llm -m gpt-4o "<prompt>" --json
 *
 * Reuses quota from multiple backends such as OpenAI / Anthropic / local Ollama.
 */
import { defineCliAdapter } from '../define';

export const llmAdapter = defineCliAdapter({
  id: 'llm',
  name: 'llm CLI',
  description:
    'The llm CLI by Simon Willison. Supports multi-backend routing across OpenAI/Anthropic/Gemini/Ollama; one of the most popular Python AI CLIs.',
  icon: '🧠',
  vendor: 'Simon Willison',
  officialDoc: 'https://llm.datasette.io',
  installHint: 'pip install llm or pipx install llm, then llm keys set openai',

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
        description: 'Run a single prompt with the llm CLI (model, system prompt, and temperature can be specified). Reuses the configured API keys.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 16000, description: 'User input' },
            model: { type: 'string', description: 'Model ID (e.g. gpt-4o, claude-3-5-sonnet, gemini-1.5-pro)' },
            system: { type: 'string', description: 'System prompt (optional)' },
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
