/**
 * OfficeCLI Adapter (Tool mode) — the same OfficeCLI as AionUI
 *
 * Command mapping (written against the public OfficeCLI protocol; patch to override if actual behavior differs):
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
    'iOfficeAI/OfficeCLI: turns requirements directly into editable finished PPT (Morph animations), Word (.docx), and Excel (.xlsx/.xlsm) deliverables. Reuses the AionUI OfficeCLI subscription quota.',
  icon: '📄',
  vendor: 'iOfficeAI',
  officialDoc: 'https://github.com/iOfficeAI/OfficeCli',
  installHint: 'brew install iofficeai/tap/officecli or npm i -g @iofficeai/office-cli, then officecli auth login',

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
          'Generate a PPT with Morph smooth animations using OfficeCLI. Suited for reporting, training, product introductions, academic defenses, and similar scenarios. Use when the user says "make a PPT" or "write a set of slides".',
        inputSchema: {
          type: 'object',
          required: ['topic', 'outline'],
          properties: {
            topic: { type: 'string', minLength: 2, maxLength: 200, description: 'PPT topic/title' },
            audience: {
              type: 'string',
              description: 'Audience profile (e.g. "investors" / "novice product managers" / "college sophomores"), used to adjust terminology density',
            },
            style: {
              type: 'string',
              enum: ['business', 'startup', 'academic', 'creative', 'minimal', 'tech_dark'],
              default: 'business',
              description: 'Visual style',
            },
            slideCount: { type: 'integer', minimum: 3, maximum: 40, default: 10, description: 'Suggested slide count' },
            outline: {
              type: 'array',
              items: { type: 'string' },
              description: 'Core points for each slide (length should be ≈ slideCount); auto-generated when left empty',
            },
            outFile: { type: 'string', description: 'Output .pptx path; auto-generated when left empty' },
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
          'Generate a structured Word (.docx) document using OfficeCLI. Suited for papers/reports/proposals/contract drafts and similar scenarios.',
        inputSchema: {
          type: 'object',
          required: ['title', 'sections'],
          properties: {
            title: { type: 'string', description: 'Document title' },
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
            outFile: { type: 'string', description: 'Output .docx path; auto-generated when left empty' },
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
          'Generate an Excel (.xlsx) with formatting/charts/formulas using OfficeCLI. Suited for data analysis output, report automation, and similar scenarios.',
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
                  data: { description: '2D array or array of objects. For arrays of objects, keys are automatically used as the header row.' },
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
            outFile: { type: 'string', description: 'Output .xlsx path; auto-generated when left empty' },
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
