/**
 * OfficeCLI Adapter（Tool 模式）—— AionUI 同款 OfficeCLI
 *
 * 命令映射（按 OfficeCLI 公开协议写，如实际不符可 patch 覆盖）：
 *   officecli ppt --topic <topic> --slides <n> --out <pptx>
 *   officecli docx --title <t> --content <file> --out <docx>
 *   officecli xlsx --data <json|csv> --sheet <name> --out <xlsx>
 *   officecli auth status
 */
import { defineCliAdapter } from '../define';

export const officeCliAdapter = defineCliAdapter({
  id: 'officecli',
  name: 'OfficeCLI',
  description:
    'iOfficeAI/OfficeCLI：把 PPT (Morph 动画)、Word (.docx)、Excel (.xlsx/.xlsm) 从需求直接生成可编辑成品。复用 AionUI OfficeCLI 订阅额度。',
  icon: '📄',
  vendor: 'iOfficeAI',
  officialDoc: 'https://github.com/iOfficeAI/OfficeCli',
  installHint: 'brew install iofficeai/tap/officecli 或 npm i -g @iofficeai/office-cli，然后 officecli auth login',

  fingerprint: {
    commandNames: ['officecli', 'office-cli'],
    versionArgs: ['--version'],
    versionPattern: /(?:office\s*cli|officecli)\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/officecli', '~/Library/Application Support/OfficeCLI'],
    envVars: ['OFFICECLI_TOKEN', 'OFFICECLI_API_KEY'],
    authCheck: {
      cmd: 'officecli auth status',
      expectAuthenticated: /(authenticated|valid|logged[-\s]?in|active)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== PPT ========
      {
        dshToolName: 'cli-hub:officecli:gen-ppt',
        description:
          '用 OfficeCLI 生成带 Morph 平滑动画的 PPT。适合汇报、培训、产品介绍、学术答辩等场景。当用户说"做一份 PPT""写一套幻灯片"时使用。',
        inputSchema: {
          type: 'object',
          required: ['topic', 'outline'],
          properties: {
            topic: { type: 'string', minLength: 2, maxLength: 200, description: 'PPT 主题/标题' },
            audience: {
              type: 'string',
              description: '观众画像（如"投资人"/"产品经理新手"/"大二学生"），用于调节术语密度',
            },
            style: {
              type: 'string',
              enum: ['business', 'startup', 'academic', 'creative', 'minimal', 'tech_dark'],
              default: 'business',
              description: '视觉风格',
            },
            slideCount: { type: 'integer', minimum: 3, maximum: 40, default: 10, description: '建议页数' },
            outline: {
              type: 'array',
              items: { type: 'string' },
              description: '每页幻灯片的核心要点（长度应 ≈ slideCount），留空可自动生成',
            },
            outFile: { type: 'string', description: '输出 .pptx 路径，留空自动生成' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'resolver',
          resolver: (input) => {
            const outFile = input.outFile ?? `./${slugify(input.topic)}-${Date.now()}.pptx`;
            const args = [
              'ppt',
              '--topic', input.topic,
              '--style', input.style ?? 'business',
              '--slides', String(input.slideCount ?? 10),
              '--out', outFile,
              '--format', 'json',
            ];
            if (input.audience) args.push('--audience', input.audience);
            if (input.outline?.length) args.push('--outline', JSON.stringify(input.outline));
            return { cmd: 'officecli', args, outputFile: outFile };
          },
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, stderr, code) => {
            if (code !== 0) throw new Error(stderr || `officecli ppt exit ${code}`);
            try { return JSON.parse(stdout); } catch {
              const m = stdout.match(/([/\w.~-]+\.pptx)/i);
              return { status: 'ok', file: m?.[1], raw: stdout.trim() };
            }
          },
        },
        timeoutMs: 300_000,
        estimatedCredits: 20,
      },

      // ======== Word ========
      {
        dshToolName: 'cli-hub:officecli:gen-word',
        description:
          '用 OfficeCLI 生成结构化 Word (.docx) 文档。适合论文/报告/方案/合同草稿等场景。',
        inputSchema: {
          type: 'object',
          required: ['title', 'sections'],
          properties: {
            title: { type: 'string', description: '文档标题' },
            template: {
              type: 'string',
              enum: ['general', 'academic_paper', 'business_report', 'contract', 'resume', 'meeting_minutes'],
              default: 'general',
            },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  heading: { type: 'string' },
                  body: { type: 'string' },
                  level: { type: 'integer', enum: [1, 2, 3], default: 2 },
                } satisfies Record<string, any> as any,
              },
            },
            outFile: { type: 'string', description: '输出 .docx 路径，留空自动生成' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'resolver',
          resolver: (input) => {
            const outFile = input.outFile ?? `./${slugify(input.title)}-${Date.now()}.docx`;
            const args = ['docx', '--title', input.title, '--template', input.template ?? 'general', '--out', outFile, '--format', 'json'];
            args.push('--sections', JSON.stringify(input.sections));
            return { cmd: 'officecli', args, outputFile: outFile };
          },
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, stderr, code) => {
            if (code !== 0) throw new Error(stderr || `officecli docx exit ${code}`);
            try { return JSON.parse(stdout); } catch {
              const m = stdout.match(/([/\w.~-]+\.docx)/i);
              return { status: 'ok', file: m?.[1], raw: stdout.trim() };
            }
          },
        },
        timeoutMs: 180_000,
        estimatedCredits: 15,
      },

      // ======== Excel ========
      {
        dshToolName: 'cli-hub:officecli:gen-excel',
        description:
          '用 OfficeCLI 生成带格式/图表/公式的 Excel (.xlsx)。适合数据分析输出、报表自动化等。',
        inputSchema: {
          type: 'object',
          required: ['sheets'],
          properties: {
            sheets: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'data'],
                properties: {
                  name: { type: 'string', maxLength: 31 },
                  data: { description: '二维数组或对象数组。对象数组会自动取 keys 作为表头。' },
                  headerStyle: { type: 'string', enum: ['default', 'bold_fill', 'bold_border'] },
                  charts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { enum: ['line', 'bar', 'column', 'pie', 'scatter', 'area'] },
                        title: { type: 'string' },
                        xRange: { type: 'string' },
                        yRange: { type: 'string' },
                      } satisfies Record<string, any> as any,
                    },
                  },
                } satisfies Record<string, any> as any,
              },
            },
            outFile: { type: 'string', description: '输出 .xlsx 路径，留空自动生成' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'resolver',
          resolver: (input) => {
            const outFile = input.outFile ?? `./excel-${Date.now()}.xlsx`;
            const args = ['xlsx', '--out', outFile, '--format', 'json', '--payload', JSON.stringify(input.sheets)];
            return { cmd: 'officecli', args, outputFile: outFile };
          },
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, stderr, code) => {
            if (code !== 0) throw new Error(stderr || `officecli xlsx exit ${code}`);
            try { return JSON.parse(stdout); } catch {
              const m = stdout.match(/([/\w.~-]+\.xlsx)/i);
              return { status: 'ok', file: m?.[1], raw: stdout.trim() };
            }
          },
        },
        timeoutMs: 180_000,
        estimatedCredits: 10,
      },
    ],
  },

  quota: {
    method: {
      kind: 'command',
      cmd: 'officecli quota --json',
      parser: (s) => {
        try {
          const r = JSON.parse(s);
          return {
            source: 'provider' as const,
            currency: (r.currency as any) ?? 'credits',
            used: r.used ?? 0,
            total: r.total ?? r.limit,
            remaining: r.remaining,
            period: (r.period as any) ?? 'monthly',
            refreshedAt: Date.now(),
            raw: r,
          };
        } catch {
          return { source: 'estimate' as const, currency: 'credits' as const, used: 0, refreshedAt: Date.now(), period: 'onetime' as const, raw: { stdout: s } };
        }
      },
    },
    refreshIntervalSec: 900,
  },

  minimumVersion: '1.2.0',
});

function slugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled';
}
