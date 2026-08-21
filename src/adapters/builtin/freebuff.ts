/**
 * FreeBuff CLI Adapter —— Tool 模式
 *
 * FreeBuff 开源安全/渗透测试 AI Agent CLI。
 *   freebuff run --json "<task>"
 *
 * 复用 FreeBuff 平台账户额度。
 */
import { defineCliAdapter } from '../define';

export const freebuffAdapter = defineCliAdapter({
  id: 'freebuff',
  name: 'FreeBuff CLI',
  description:
    'FreeBuff 开源安全/渗透测试 AI Agent CLI。可作 Tool 模式执行安全分析、漏洞扫描、代码审计任务。',
  icon: '🛡️',
  vendor: 'FreeBuff',
  officialDoc: 'https://github.com/freebuff/freebuff-cli',
  installHint: 'npm i -g freebuff，然后 freebuff auth login',

  fingerprint: {
    commandNames: ['freebuff', 'freebuff-cli'],
    versionArgs: ['--version'],
    versionPattern: /freebuff(?:[-\s]cli)?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.freebuff', '~/.config/freebuff'],
    envVars: ['FREEBUFF_API_KEY', 'FREEBUFF_TOKEN'],
    authCheck: {
      cmd: 'freebuff auth status',
      expectAuthenticated: /(valid|ok|active|authenticated)/i,
      expectUnauthenticated: /(no.*key|not.*set|unauthenticated)/i,
    },
  },

  capabilities: {
    tools: [
      {
        dshToolName: 'cli-hub:freebuff:scan',
        description: '用 FreeBuff CLI 执行安全扫描/漏洞分析任务。',
        inputSchema: {
          type: 'object',
          required: ['target'],
          properties: {
            target: { type: 'string', minLength: 1, maxLength: 2000, description: '扫描目标（URL/IP/文件路径）' },
            mode: {
              type: 'string',
              enum: ['quick', 'deep', 'audit'],
              default: 'quick',
              description: '扫描模式：quick 快速 / deep 深度 / audit 代码审计',
            },
            workdir: { type: 'string', description: '工作目录' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'template',
          template: 'freebuff run --mode {{mode}} --cwd {{workdir}} --json "{{target}}"',
          workdirVar: 'workdir',
        },
        outputParser: 'stdout-json',
        timeoutMs: 600_000,
        estimatedCredits: 30,
      },
    ],
  },

  minimumVersion: '0.1.0',
});
