/**
 * Kimi CLI Adapter —— Tool 模式（联网搜索、长文档阅读）+ Agent 模式预留
 *
 * 基于 Moonshot/Kimi CLI 的通用公开协议风格。
 *   kimi search --query "..." --json
 *   kimi read --file <path> --mode summary --json
 *   kimi chat --json --stdio  ← （Agent 模式 V2 再接入）
 */
import { defineCliAdapter } from '../define';

export const kimiCliAdapter = defineCliAdapter({
  id: 'kimi-cli',
  name: 'Kimi CLI',
  description:
    '月之暗面 Kimi 官方/社区 CLI。联网搜索能力强、长文档上下文大。可作为 Tool 模式的"搜索引擎 + 长文档阅读器"，也可作为独立子 Agent（后续版本接入）。',
  icon: '🌙',
  vendor: 'Moonshot AI',
  officialDoc: 'https://github.com/kimi-open/kimi-cli',
  installHint: 'pip install kimi-cli 或 npm i -g @moonshot-ai/kimi-cli，然后 kimi auth set-token $KIMI_API_KEY',

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
      // ======== 联网搜索 ========
      {
        dshToolName: 'cli-hub:kimi-cli:search',
        description:
          'Kimi 联网搜索。返回带来源 URL 的真实网页结果，比单纯 LLM 回答更可靠。当用户问到最新信息、需要查证事实、需要引用来源、事件发生在最近 12 个月时，必须优先使用此工具。',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 500, description: '搜索关键词/问题' },
            maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
            freshness: {
              type: 'string',
              enum: ['any', 'day', 'week', 'month', 'year'],
              default: 'any',
              description: '结果时间范围',
            },
            language: { type: 'string', description: '结果语言偏好（zh/en/...），留空自动' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: "kimi search --query {{query}} --max {{maxResults}} --freshness {{freshness}} --lang {{language}} --json",
        },
        outputParser: 'stdout-json',
        timeoutMs: 45_000,
        estimatedCredits: 2,
      },

      // ======== 长文档阅读 ========
      {
        dshToolName: 'cli-hub:kimi-cli:read-long',
        description:
          'Kimi 长文档阅读器。支持超长 PDF/Word/Markdown/TXT（200 万字上下文），输出摘要、要点、Q&A 对。当用户上传长文档、需要全文理解时使用；小文件用 DSH 自带文件工具即可。',
        inputSchema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', description: '文档绝对路径' },
            mode: {
              type: 'string',
              enum: ['summary', 'key_points', 'qa', 'outline'],
              default: 'summary',
              description:
                'summary=自然语言摘要；key_points=要点列表；qa=自问自答 10 对；outline=大纲',
            },
            focus: { type: 'string', description: '阅读关注点（如"财务数据""法律条款"），留空综合阅读' },
            detailLevel: {
              type: 'string',
              enum: ['brief', 'standard', 'detailed'],
              default: 'standard',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: "kimi read --file {{file}} --mode {{mode}} --focus {{focus}} --detail {{detailLevel}} --json",
        },
        outputParser: 'stdout-json',
        timeoutMs: 180_000,
        estimatedCredits: 5,
      },
    ],

    // Agent 模式（V2 里程碑 M4 时启用）—— 先声明占位，Runtime 暂不 spawn
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
        description: 'Kimi 长文档+联网搜索强项的子 Agent',
        avatarEmoji: '🌙',
        strengths: ['长文档', '搜索', '学术'],
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
