/**
 * Snow CLI Adapter（Tool 模式）
 *
 * 参考：Snow CLI 常见命令
 *   snow draw --prompt <text> --out <path>           # 画图
 *   snow translate --text <text> --from zh --to en    # 翻译
 *   snow tts --text <text> --voice xxx --out <path>   # 文生声
 *   snow asr --in <path>                              # 语音转写
 *   snow auth status                                  # 登录状态
 *   snow quota --json                                 # 额度
 *
 * 注意：命令参数名基于通用 AI CLI 约定；实际 Snow CLI 若参数名不同，用户可以通过
 *       registry 的 adapterOverrides 覆盖 commandMapping.template。
 */
import { defineCliAdapter } from '../define';

export const snowCliAdapter = defineCliAdapter({
  id: 'snow-cli',
  name: 'Snow CLI',
  description: 'Snowflake AI 官方 CLI，提供画图、机器翻译、文生语音、语音转写等多模态能力。直接复用 Snow 账户已订阅额度。',
  icon: '❄️',
  vendor: 'Snowflake AI',
  officialDoc: 'https://docs.snowflake.com/en/user-guide/snow-cli',
  installHint: 'npm i -g @snowflake-ai/snow-cli 或 pip install snow-cli；再执行 snow auth login',

  fingerprint: {
    commandNames: ['snow', 'snow-cli', 'snowflake'],
    versionArgs: ['--version'],
    versionPattern: /(?:snow|snowflake)[\s-]*cli?\s*v?([0-9][\w.+-]*)/i,
    configPaths: ['~/.config/snow', '~/Library/Application Support/Snowflake', '~/.snowflake'],
    envVars: ['SNOW_TOKEN', 'SNOWFLAKE_TOKEN', 'SNOW_API_KEY'],
    authCheck: {
      cmd: 'snow auth status',
      expectAuthenticated: /(logged[-\s]?in|authenticated|valid|active|signed in)/i,
      expectUnauthenticated: /(not logged|unauthenticated|no.*credential|please.*login|signed out)/i,
      expectExpired: /(expired|invalid.*token|token.*expired)/i,
    },
  },

  capabilities: {
    tools: [
      // ======== 画图 ========
      {
        dshToolName: 'cli-hub:snow-cli:draw',
        description:
          'Snow CLI 多模态画图。根据提示词生成图片并保存到本地。支持写实/插画/动漫等多种风格。当用户要求画图、生成图片、设计海报、制作插画时使用。',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              minLength: 2,
              maxLength: 1000,
              description: '图片描述提示词（英文或中文），建议包含主体、风格、光影、构图等要素',
            },
            style: {
              type: 'string',
              enum: ['realistic', 'anime', 'illustration', '3d', 'oil_painting', 'watercolor', 'sketch', 'cyberpunk'],
              description: '图片风格（可选）',
            },
            size: {
              type: 'string',
              enum: ['512x512', '768x768', '1024x1024', '1024x768', '768x1024', '1536x1024', '1024x1536'],
              default: '1024x1024',
              description: '图片尺寸',
            },
            outFile: {
              type: 'string',
              description: '输出文件路径（绝对路径或工作目录相对路径），留空会自动生成',
            },
            seed: { type: 'integer', minimum: 0, maximum: 4_294_967_295, description: '随机种子（可选，固定种子复现结果）' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'snow',
          args: [
            'draw',
            { flag: '--prompt', var: 'prompt' },
            { flag: '--style', var: 'style' },
            { flag: '--size', var: 'size', defaultValue: '1024x1024' },
            { flag: '--out', var: 'outFile' },
            { flag: '--seed', var: 'seed' },
          ],
          outputFileVar: 'outFile',
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, stderr, code) => {
            // Snow CLI 画图通常输出生成的路径
            if (code !== 0 && !stdout.trim()) throw new Error(stderr || `exit ${code}`);
            const pathMatch = stdout.match(/(?:saved|wrote|output|→|->|generated)[^\n"]*?([/\w.~-]+\.(?:png|jpg|jpeg|webp))/i);
            if (pathMatch) return { status: 'ok', generatedFile: pathMatch[1], raw: stdout.trim() };
            return { status: code === 0 ? 'ok' : 'warn', message: stdout.trim() || stderr.trim() };
          },
        },
        timeoutMs: 120_000,
        estimatedCredits: 8,
      },

      // ======== 翻译 ========
      {
        dshToolName: 'cli-hub:snow-cli:translate',
        description:
          'Snow CLI 高质量机器翻译。支持中英日韩法德西意俄阿葡等 100+ 语言。当用户需要翻译文本、翻译文档片段、本地化内容时使用。通常比 LLM 自翻译更稳定、更省 token。',
        inputSchema: {
          type: 'object',
          required: ['text', 'targetLang'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 10_000, description: '待翻译文本' },
            sourceLang: {
              type: 'string',
              description: '源语言（ISO 639-1，如 zh, en, ja），留空自动检测',
            },
            targetLang: {
              type: 'string',
              description: '目标语言（ISO 639-1）',
              examples: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'],
            },
            domain: {
              type: 'string',
              enum: ['general', 'tech', 'medical', 'legal', 'finance', 'literature'],
              default: 'general',
              description: '领域（可选，提升专业术语准确率）',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'snow',
          args: [
            'translate',
            { flag: '--text', var: 'text' },
            { flag: '--from', var: 'sourceLang' },
            { flag: '--to', var: 'targetLang' },
            { flag: '--domain', var: 'domain', defaultValue: 'general' },
            '--format', 'json',
          ],
        },
        outputParser: 'stdout-json',
        timeoutMs: 30_000,
        estimatedCredits: 1,
      },

      // ======== 文生语音 ========
      {
        dshToolName: 'cli-hub:snow-cli:tts',
        description:
          'Snow CLI 文本转语音。把文字合成自然语音并保存为音频文件。当用户需要朗读文章、制作配音、生成有声书时使用。',
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 5000, description: '要合成的文本内容' },
            voice: {
              type: 'string',
              enum: ['male-zh', 'female-zh', 'male-en', 'female-en', 'male-ja', 'female-ja', 'child', 'news'],
              default: 'female-zh',
              description: '音色',
            },
            speed: { type: 'number', minimum: 0.5, maximum: 2.0, default: 1.0, description: '语速倍数' },
            outFile: {
              type: 'string',
              description: '输出音频文件路径（.mp3/.wav/.m4a），留空自动生成',
            },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'snow',
          args: [
            'tts',
            { flag: '--text', var: 'text' },
            { flag: '--voice', var: 'voice', defaultValue: 'female-zh' },
            { flag: '--speed', var: 'speed', defaultValue: '1.0' },
            { flag: '--out', var: 'outFile' },
          ],
          outputFileVar: 'outFile',
        },
        outputParser: {
          kind: 'custom',
          fn: (stdout, _stderr, code) => {
            if (code !== 0 && !stdout.trim()) throw new Error('tts failed');
            const fileMatch = stdout.match(/([/\w.~-]+\.(?:mp3|wav|m4a|flac|aac))/i);
            return { status: code === 0 ? 'ok' : 'warn', audioFile: fileMatch?.[1], raw: stdout.trim() };
          },
        },
        timeoutMs: 60_000,
        estimatedCredits: 3,
      },

      // ======== 语音转写 ========
      {
        dshToolName: 'cli-hub:snow-cli:asr',
        description:
          'Snow CLI 语音转文字。把本地音频/视频文件转写为带时间戳的文本，支持识别语言自动检测。当用户上传录音、会议纪要、视频字幕时使用。',
        inputSchema: {
          type: 'object',
          required: ['inFile'],
          properties: {
            inFile: { type: 'string', description: '输入音频/视频文件绝对路径' },
            lang: { type: 'string', description: '强制指定语言（留空自动检测）' },
            withTimestamp: { type: 'boolean', default: true, description: '输出是否带时间戳' },
            withSpeaker: { type: 'boolean', default: false, description: '是否开启说话人分离' },
          } satisfies Record<string, any> as any,
        },
        commandMapping: {
          kind: 'argv',
          command: 'snow',
          args: [
            'asr',
            { flag: '--in', var: 'inFile' },
            { flag: '--lang', var: 'lang' },
            { flag: '--timestamp', var: 'withTimestamp', defaultValue: 'true' },
            { flag: '--speaker', var: 'withSpeaker', defaultValue: 'false' },
            '--format', 'json',
          ],
        },
        outputParser: 'stdout-json',
        timeoutMs: 300_000,
        estimatedCredits: 5,
      },
    ],

    // === Agent 模式：Snow CLI REPL（多模态 Agent，持久化会话）===
    agent: {
      protocol: 'line-based',
      spawn: {
        command: 'snow',
        argsTemplate: [
          'repl',
          '--workspace', '{{workspace}}',
          '--no-color',
        ],
        // Snow CLI REPL 启动时会打印 `snow>` 或 `Snow>` 提示符
        readyPattern: 'snow>',
        readyTimeoutMs: 10_000,
        gracefulShutdownSignal: 'SIGTERM',
        shutdownGraceMs: 2000,
      },
      agentMeta: {
        displayName: 'Snow AI',
        description: 'Snowflake AI 多模态 Agent（画图/翻译/TTS/ASR + 聊天推理）。复用 Snow 账户订阅额度。',
        avatarEmoji: '❄️',
        strengths: ['多模态生成', '机器翻译', '语音合成/识别', '画图'],
        supportsStreaming: true,
      },
      shareDshTools: false,
    },
  },

  quota: {
    method: {
      kind: 'command',
      cmd: 'snow quota --json',
      parser: (stdout: string) => {
        let raw: any;
        try { raw = JSON.parse(stdout); } catch {
          // Fallback：正则解析文本格式
          const used = Number(stdout.match(/(?:used|消耗)[^\d]*(\d+(?:\.\d+)?)/i)?.[1] ?? NaN);
          const total = Number(stdout.match(/(?:total|总额|limit|上限)[^\d]*(\d+(?:\.\d+)?)/i)?.[1] ?? NaN);
          return {
            source: 'provider' as const,
            currency: 'credits' as const,
            used: Number.isFinite(used) ? used : 0,
            total: Number.isFinite(total) ? total : undefined,
            remaining: Number.isFinite(total) && Number.isFinite(used) ? total - used : undefined,
            refreshedAt: Date.now(),
            period: 'monthly' as const,
            raw: { stdout },
          };
        }
        const credits = raw.credits ?? raw.quota ?? raw;
        return {
          source: 'provider' as const,
          currency: (credits.currency as any) ?? 'credits',
          used: credits.used ?? 0,
          total: credits.total ?? credits.limit,
          remaining: credits.remaining ?? (credits.total ? credits.total - (credits.used ?? 0) : undefined),
          period: (credits.period as any) ?? 'monthly',
          refreshedAt: Date.now(),
          expiresAt: credits.expiresAt ? new Date(credits.expiresAt).getTime() : undefined,
          breakdown: credits.breakdown,
          raw,
        };
      },
    },
    refreshIntervalSec: 600,
  },

  minimumVersion: '0.5.0',
});
