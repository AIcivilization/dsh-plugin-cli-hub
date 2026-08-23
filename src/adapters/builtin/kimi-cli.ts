/**
 * Kimi CLI Adapter — Tool mode (web search, long-document reading) + Agent mode reserved
 *
 * Based on the general public protocol style of Moonshot/Kimi CLI.
 *   kimi search --query "..." --json
 *   kimi read --file <path> --mode summary --json
 *   kimi chat --json --stdio  ← (Agent mode integration in V2)
 */
import { defineCliAdapter } from '../define';

export const kimiCliAdapter = defineCliAdapter({
  id: 'kimi-cli',
  name: 'Kimi CLI',
  description:
    'Moonshot AI Kimi official/community CLI. Strong web search capability and large long-document context. Can serve as a "search engine + long-document reader" in Tool mode, or as an independent sub-Agent (integration in a later version).',
  icon: '🌙',
  vendor: 'Moonshot AI',
  officialDoc: 'https://github.com/kimi-open/kimi-cli',
  installHint: 'pip install kimi-cli or npm i -g @moonshot-ai/kimi-cli, then kimi auth set-token $KIMI_API_KEY',

  fingerprint: {
    commandNames: ['kimi', 'kimi-cli'],
    versionArgs: ['--version'],
    versionPattern: /kimi(?:\s*cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/kimi', '~/.kimi'],
    envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_TOKEN'],
    authCheck: {
      cmd: 'kimi auth status',
      expectAuthenticated: /(valid|ok|active|token.*set|authenticated)/i,
      expectUnauthenticated: /(no.*(token|key)|not.*set|unauthenticated|please.*(token|login))/i,
    },
  },

  capabilities: {
    tools: [
      // ======== Web search ========
      {
        dshToolName: 'cli-hub:kimi-cli:search',
        description:
          'Kimi web search. Returns real web results with source URLs, more reliable than plain LLM answers. Prefer this tool whenever the user asks about the latest information, needs to verify facts, needs to cite sources, or the event occurred within the last 12 months.',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 500, description: 'Search keywords/question' },
            maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
            freshness: {
              type: 'string',
              enum: ['any', 'day', 'week', 'month', 'year'],
              default: 'any',
              description: 'Time range of results',
            },
            language: { type: 'string', description: 'Result language preference (zh/en/...); automatic if left empty' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'kimi',
          args: [
            'search',
            { flag: '--query', var: 'query' },
            { flag: '--max', var: 'maxResults', defaultValue: '8' },
            { flag: '--freshness', var: 'freshness', defaultValue: 'any' },
            { flag: '--lang', var: 'language' },
            '--json',
          ],
        },
        outputParser: 'stdout-json',
        timeoutMs: 45_000,
        estimatedCredits: 2,
      },

      // ======== Long-document reading ========
      {
        dshToolName: 'cli-hub:kimi-cli:read-long',
        description:
          'Kimi long-document reader. Supports very long PDF/Word/Markdown/TXT files (2-million-character context) and outputs summaries, key points, and Q&A pairs. Use when the user uploads a long document or needs full-text understanding; for small files, the DSH built-in file tools are enough.',
        inputSchema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', description: 'Absolute path to the document' },
            mode: {
              type: 'string',
              enum: ['summary', 'key_points', 'qa', 'outline'],
              default: 'summary',
              description:
                'summary=natural-language summary; key_points=list of key points; qa=10 self-generated Q&A pairs; outline=outline',
            },
            focus: { type: 'string', description: 'Reading focus (e.g., "financial data", "legal terms"); reads comprehensively if left empty' },
            detailLevel: {
              type: 'string',
              enum: ['brief', 'standard', 'detailed'],
              default: 'standard',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'kimi',
          args: [
            'read',
            { flag: '--file', var: 'file' },
            { flag: '--mode', var: 'mode', defaultValue: 'summary' },
            { flag: '--focus', var: 'focus' },
            { flag: '--detail', var: 'detailLevel', defaultValue: 'standard' },
            '--json',
          ],
        },
        outputParser: 'stdout-json',
        timeoutMs: 180_000,
        estimatedCredits: 5,
      },
    ],

    // Agent mode (enabled in V2 milestone M4) — declared as a placeholder for now; Runtime does not spawn it yet
    agent: {
      protocol: 'stdio-jsonrpc',
      spawn: {
        command: 'kimi',
        argsTemplate: ['chat', '--json', '--stdio', '--no-color', '--workspace', '{{workspace}}'],
        readyPattern: 'READY',
        readyTimeoutMs: 15_000,
      },
      agentMeta: {
        displayName: 'Kimi Agent',
        description: 'Sub-Agent with strong long-document reading + web search capabilities',
        avatarEmoji: '🌙',
        strengths: ['Long documents', 'Search', 'Academic'],
      },
      shareDshTools: true,
    },
  },

  quota: {
    method: {
      kind: 'command',
      cmd: 'kimi quota --json',
      parser: (s) => {
        try {
          const r = JSON.parse(s);
          return {
            source: 'provider' as const,
            currency: 'tokens' as const,
            used: r.used ?? r.usedTokens ?? 0,
            total: r.total ?? r.limit ?? r.totalTokens,
            remaining: r.remaining ?? r.remainingTokens,
            period: (r.period as any) ?? 'monthly',
            refreshedAt: Date.now(),
            raw: r,
          };
        } catch {
          return { source: 'estimate' as const, currency: 'tokens' as const, used: 0, refreshedAt: Date.now(), period: 'onetime' as const, raw: { stdout: s } };
        }
      },
    },
    refreshIntervalSec: 300,
  },

  minimumVersion: '0.3.0',
});
