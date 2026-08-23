/**
 * Snow CLI Adapter (Tool mode)
 *
 * Reference: common Snow CLI commands
 *   snow draw --prompt <text> --out <path>           # image generation
 *   snow translate --text <text> --from zh --to en    # translation
 *   snow tts --text <text> --voice xxx --out <path>   # text-to-speech
 *   snow asr --in <path>                              # speech transcription
 *   snow auth status                                  # login status
 *   snow quota --json                                 # quota
 *
 * Note: command argument names follow common AI CLI conventions; if the actual Snow CLI uses
 *       different argument names, users can override commandMapping.template via registry adapterOverrides.
 */
import { defineCliAdapter } from '../define';

export const snowCliAdapter = defineCliAdapter({
  id: 'snow-cli',
  name: 'Snow CLI',
  description: 'Snowflake AI official CLI providing multimodal capabilities such as image generation, machine translation, text-to-speech, and speech transcription. Directly reuses the Snow account subscription quota.',
  icon: '❄️',
  vendor: 'Snowflake AI',
  officialDoc: 'https://docs.snowflake.com/en/user-guide/snow-cli',
  installHint: 'npm i -g @snowflake-ai/snow-cli or pip install snow-cli; then run snow auth login',

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
      // ======== Image generation ========
      {
        dshToolName: 'cli-hub:snow-cli:draw',
        description:
          'Snow CLI multimodal image generation. Generates images from a prompt and saves them locally. Supports various styles such as realistic/illustration/anime. Use when the user asks to draw, generate images, design posters, or create illustrations.',
        inputSchema: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: {
              type: 'string',
              minLength: 2,
              maxLength: 1000,
              description: 'Image description prompt (English or Chinese); recommended to include subject, style, lighting, composition, etc.',
            },
            style: {
              type: 'string',
              enum: ['realistic', 'anime', 'illustration', '3d', 'oil_painting', 'watercolor', 'sketch', 'cyberpunk'],
              description: 'Image style (optional)',
            },
            size: {
              type: 'string',
              enum: ['512x512', '768x768', '1024x1024', '1024x768', '768x1024', '1536x1024', '1024x1536'],
              default: '1024x1024',
              description: 'Image size',
            },
            outFile: {
              type: 'string',
              description: 'Output file path (absolute or relative to the working directory); auto-generated if left empty',
            },
            seed: { type: 'integer', minimum: 0, maximum: 4_294_967_295, description: 'Random seed (optional; a fixed seed reproduces results)' },
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
            // Snow CLI image generation usually outputs the generated file path
            if (code !== 0 && !stdout.trim()) throw new Error(stderr || `exit ${code}`);
            const pathMatch = stdout.match(/(?:saved|wrote|output|→|->|generated)[^\n"]*?([/\w.~-]+\.(?:png|jpg|jpeg|webp))/i);
            if (pathMatch) return { status: 'ok', generatedFile: pathMatch[1], raw: stdout.trim() };
            return { status: code === 0 ? 'ok' : 'warn', message: stdout.trim() || stderr.trim() };
          },
        },
        timeoutMs: 120_000,
        estimatedCredits: 8,
      },

      // ======== Translation ========
      {
        dshToolName: 'cli-hub:snow-cli:translate',
        description:
          'Snow CLI high-quality machine translation. Supports 100+ languages including Chinese, English, Japanese, Korean, French, German, Spanish, Italian, Russian, Arabic, and Portuguese. Use when the user needs to translate text, translate document fragments, or localize content. Usually more stable and more token-efficient than LLM self-translation.',
        inputSchema: {
          type: 'object',
          required: ['text', 'targetLang'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 10_000, description: 'Text to translate' },
            sourceLang: {
              type: 'string',
              description: 'Source language (ISO 639-1, e.g., zh, en, ja); auto-detected if left empty',
            },
            targetLang: {
              type: 'string',
              description: 'Target language (ISO 639-1)',
              examples: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'],
            },
            domain: {
              type: 'string',
              enum: ['general', 'tech', 'medical', 'legal', 'finance', 'literature'],
              default: 'general',
              description: 'Domain (optional; improves terminology accuracy)',
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

      // ======== Text-to-speech ========
      {
        dshToolName: 'cli-hub:snow-cli:tts',
        description:
          'Snow CLI text-to-speech. Synthesizes natural speech from text and saves it as an audio file. Use when the user needs to read articles aloud, create voiceovers, or generate audiobooks.',
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 5000, description: 'Text content to synthesize' },
            voice: {
              type: 'string',
              enum: ['male-zh', 'female-zh', 'male-en', 'female-en', 'male-ja', 'female-ja', 'child', 'news'],
              default: 'female-zh',
              description: 'Voice',
            },
            speed: { type: 'number', minimum: 0.5, maximum: 2.0, default: 1.0, description: 'Speech speed multiplier' },
            outFile: {
              type: 'string',
              description: 'Output audio file path (.mp3/.wav/.m4a); auto-generated if left empty',
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

      // ======== Speech transcription ========
      {
        dshToolName: 'cli-hub:snow-cli:asr',
        description:
          'Snow CLI speech-to-text. Transcribes local audio/video files into timestamped text, with automatic language detection. Use when the user uploads recordings, meeting notes, or video subtitles.',
        inputSchema: {
          type: 'object',
          required: ['inFile'],
          properties: {
            inFile: { type: 'string', description: 'Absolute path to the input audio/video file' },
            lang: { type: 'string', description: 'Force a specific language (auto-detected if left empty)' },
            withTimestamp: { type: 'boolean', default: true, description: 'Whether the output includes timestamps' },
            withSpeaker: { type: 'boolean', default: false, description: 'Whether to enable speaker diarization' },
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

    // === Agent mode: Snow CLI REPL (multimodal Agent, persistent session) ===
    agent: {
      protocol: 'line-based',
      spawn: {
        command: 'snow',
        argsTemplate: [
          'repl',
          '--workspace', '{{workspace}}',
          '--no-color',
        ],
        // Snow CLI REPL prints a `snow>` or `Snow>` prompt on startup
        readyPattern: 'snow>',
        readyTimeoutMs: 10_000,
        gracefulShutdownSignal: 'SIGTERM',
        shutdownGraceMs: 2000,
      },
      agentMeta: {
        displayName: 'Snow AI',
        description: 'Snowflake AI multimodal Agent (image generation/translation/TTS/ASR + chat reasoning). Reuses the Snow account subscription quota.',
        avatarEmoji: '❄️',
        strengths: ['Multimodal generation', 'Machine translation', 'Speech synthesis/recognition', 'Image generation'],
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
          // Fallback: parse the text format with regex
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
