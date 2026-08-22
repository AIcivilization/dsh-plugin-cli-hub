/**
 * 核心数据契约（松耦合版本：不直接强依赖 cordis rc 的内部 symbol）
 */
import type { Service } from 'cordis';

// 兼容 JSONSchema 类型（不锁定 json-schema-to-ts 的具体导出路径）
export type JSONSchema7 = {
  $schema?: string;
  $id?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  required?: string[];
  properties?: Record<string, any>;
  items?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: any;
  description?: string;
  examples?: any[];
  pattern?: string;
  format?: string;
  oneOf?: any[];
  anyOf?: any[];
  allOf?: any[];
  [k: string]: any;
};

// ============================================================
// 1. 基础枚举
// ============================================================
export type ScanDepth = 'l1' | 'l2' | 'l3';

export type AuthState = 'unknown' | 'authenticated' | 'unauthenticated' | 'expired';

export type CapabilityMode = 'tool' | 'agent';

export type QuotaSource = 'provider' | 'estimate';

export type QuotaCurrency = 'credits' | 'tokens' | 'usd' | 'calls' | 'minutes';

export type AgentProtocol = 'acp' | 'mcp-stdio' | 'stdio-jsonrpc' | 'line-based' | 'stream-json';

export type SandboxLevel = 'strict' | 'relaxed';

// ============================================================
// 2. CLI 指纹（Scanner 用）
// ============================================================
export interface CliFingerprint {
  commandNames: string[];
  versionArgs?: string[];
  versionPattern?: RegExp;
  configPaths?: string[];
  envVars?: string[];
  authCheck?: {
    cmd: string;
    expectAuthenticated?: RegExp;
    expectUnauthenticated?: RegExp;
    expectExpired?: RegExp;
  };
}

// ============================================================
// 3. Tool / Agent 能力声明
// ============================================================
export interface ToolCapabilityDeclaration {
  dshToolName: string;
  description: string;
  inputSchema: JSONSchema7;
  commandMapping:
    | {
        /**
         * 推荐方式：按数组传入 argv，每个变量独立一个 argv[i]，天然避免空格/引号注入。
         * 支持字符串常量、变量、flag 开关（skipIfEmpty）、可选值四种形式。
         */
        kind: 'argv';
        command: string;                              // 可执行文件基名或绝对路径，推荐基名，由 gateway-tool 替换为 rt.execPath
        args: Array<
          | string                                    // 字面量，例如 '--json'
          | {
              /** 从 input / runtimeCtx 自动变量里取值 */
              var: string;
              /** 若该变量为空或未定义，整个 argv 项（连同前面的 flag，如果在 pair 中）跳过不传 */
              defaultValue?: string;
              /** 当值为空或 undefined 时跳过，而不是用 defaultValue/空串。纯 flag 场景用不到，纯 var 不传很方便 */
              skipIfEmpty?: boolean;
            }
          | {
              /** pair 模式：若变量有值，则传 ['--flag', value]；否则都跳过 */
              flag: string;
              var: string;
              defaultValue?: string;
            }
        >;
        outputFileVar?: string;                       // 声明 input 里哪个字段代表"输出文件路径"，会在 __output__ 变量等地方生效
        workdirVar?: string;                          // 声明 input 里哪个字段代表"工作目录"，缺省走 runtimeCtx.workspace
      }
    | {
        /**
         * 【Deprecated，将在 v0.2.0 移除】
         * 向后兼容的字符串模板方式。会在运行时记录 DEPRECATE 警告。
         * 字符串里的引号、空格会按 shell token 切分，但变量依然直接替换为独立参数（execFile 不经 shell）。
         * 新 adapter 请直接使用 kind: 'argv'。
         */
        kind: 'template';
        template: string;
        outputFileVar?: string;
        workdirVar?: string;
      }
    | {
        kind: 'resolver';
        resolver: (
          input: Record<string, any>,
          ctx: RuntimeContext,
        ) => {
          cmd: string;
          args: string[];
          cwd?: string;
          env?: Record<string, string>;
          outputFile?: string;
        };
      };
  outputParser:
    | 'stdout-text'
    | 'stdout-json'
    | 'stderr-text'
    | 'exit-code-only'
    | {
        kind: 'custom';
        fn: (stdout: string, stderr: string, exitCode: number) => any;
      };
  timeoutMs?: number;
  estimatedCredits?: number;
  interactive?: boolean;
}

export interface AgentCapabilityDeclaration {
  protocol: AgentProtocol;
  spawn: {
    command: string;
    argsTemplate: string[];
    env?: Record<string, string>;
    workdirVar?: string;
    readyPattern?: string;
    readyTimeoutMs?: number;
    gracefulShutdownSignal?: 'SIGINT' | 'SIGTERM';
    shutdownGraceMs?: number;
  };
  agentMeta?: {
    displayName: string;
    description: string;
    avatarEmoji?: string;
    strengths?: string[];
    supportsStreaming?: boolean;
  };
  shareDshTools?: boolean;
}

// ============================================================
// 4. 额度声明
// ============================================================
export interface QuotaDeclaration {
  method:
    | {
        kind: 'command';
        cmd: string;
        parser: (stdout: string) => QuotaInfo;
      }
    | {
        kind: 'http';
        url: string;
        headers?: Record<string, string>;
        authHeader?: string | (() => Promise<string>);
        parser: (resp: any) => QuotaInfo;
      }
    | {
        kind: 'file';
        path: string;
        parser: (content: string) => QuotaInfo;
      }
    | {
        kind: 'unknown';
      };
  refreshIntervalSec?: number;
  estimatePerToolCall?: (toolName: string, input: any, output: any) => number;
  estimatePerAgentTurn?: (inputTokens: number, outputTokens: number) => number;
}

export interface QuotaInfo {
  source: QuotaSource;
  currency: QuotaCurrency;
  total?: number;
  used: number;
  remaining?: number;
  period?: 'daily' | 'monthly' | 'subscription' | 'onetime';
  refreshedAt: number;
  expiresAt?: number;
  breakdown?: Array<{ capability: string; used: number; limit?: number }>;
  raw?: any;
}

// ============================================================
// 5. Adapter 完整定义
// ============================================================
export interface CliAdapterDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  vendor?: string;
  officialDoc?: string;
  installHint?: string;
  defaultEnabled?: boolean;
  fingerprint: CliFingerprint;
  capabilities: {
    tools?: ToolCapabilityDeclaration[];
    agent?: AgentCapabilityDeclaration;
  };
  quota?: QuotaDeclaration;
  minimumVersion?: string;
}

// ============================================================
// 6. 运行期类型
// ============================================================
export interface RuntimeContext {
  workspace: string;
  homedir: string;
  env: Record<string, string>;
  sessionId?: string;
  registerAttachment?: (localPath: string) => Promise<{ url: string; id: string }>;
}

export interface ScanItem {
  adapterId: string | null;
  executablePath: string;
  commandName: string;
  version: string | null;
  authState: AuthState;
  authHint?: string;
  error?: string;
  scannedDepth: ScanDepth | 'l3';
}

export interface ScanResult {
  scannedAt: number;
  depth: ScanDepth;
  items: ScanItem[];
  summary: {
    total: number;
    matched: number;
    enabled: number;
    authenticated: number;
    quotaWarning: number;
  };
}

// ============================================================
// 7. ctx.cliHub 服务接口
//    · 注意：不 extends cordis.Service 基类，避免 rc 版本的 symbol 冲突。
//      运行期 ctx.set('cliHub', obj) 是 duck-typing。
// ============================================================
export type CliHubService = {
  registry: import('./registry').RegistryService;
  scanner: import('./scanner').ScannerService;
  quota: import('./quota').QuotaManagerService;
  tools: import('./gateway-tool').ToolGateway;
  agents: import('./gateway-agent').AgentGateway;

  scan(depth?: ScanDepth): Promise<ScanResult>;
  list(filter?: { onlyEnabled?: boolean; mode?: CapabilityMode }): CliAdapterDefinition[];
  enable(adapterId: string): void;
  disable(adapterId: string): void;
};
// 允许作为 Service 语义兼容
export type CliHubServiceCompat = CliHubService & Partial<Service>;
