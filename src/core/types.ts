/**
 * Core data contracts (loosely coupled: no hard dependency on cordis rc internal symbols)
 */
import type { Service } from 'cordis';

// JSONSchema-compatible type (not tied to json-schema-to-ts's specific export paths)
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
// 1. Basic enums
// ============================================================
export type ScanDepth = 'l1' | 'l2' | 'l3';

export type AuthState = 'unknown' | 'authenticated' | 'unauthenticated' | 'expired';

export type CapabilityMode = 'tool' | 'agent';

export type QuotaSource = 'provider' | 'estimate';

export type QuotaCurrency = 'credits' | 'tokens' | 'usd' | 'calls' | 'minutes';

export type AgentProtocol = 'acp' | 'mcp-stdio' | 'stdio-jsonrpc' | 'line-based' | 'stream-json';

export type SandboxLevel = 'strict' | 'relaxed';

// ============================================================
// 2. CLI fingerprint (used by Scanner)
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
// 3. Tool / Agent capability declarations
// ============================================================
export interface ToolCapabilityDeclaration {
  dshToolName: string;
  description: string;
  inputSchema: JSONSchema7;
  commandMapping:
    | {
        /**
         * Recommended: pass argv as an array, one argv[i] per variable, naturally avoiding
         * whitespace/quote injection. Supports four forms: string constants, variables,
         * flag toggles (skipIfEmpty), and optional values.
         */
        kind: 'argv';
        command: string;                              // Executable basename or absolute path; basename recommended, gateway-tool replaces it with rt.execPath
        args: Array<
          | string                                    // Literal, e.g. '--json'
          | {
              /** Take value from input / runtimeCtx automatic variables */
              var: string;
              /** If this variable is empty or undefined, the whole argv item (including the preceding flag in pair mode) is skipped */
              defaultValue?: string;
              /** Skip when value is empty or undefined instead of using defaultValue/empty string. Not needed for pure flags; convenient for optional vars */
              skipIfEmpty?: boolean;
            }
          | {
              /** Pair mode: if the variable has a value, pass ['--flag', value]; otherwise skip both */
              flag: string;
              var: string;
              defaultValue?: string;
            }
        >;
        outputFileVar?: string;                       // Declares which input field is the "output file path"; used by the __output__ variable and elsewhere
        workdirVar?: string;                          // Declares which input field is the "working directory"; defaults to runtimeCtx.workspace
      }
    | {
        /**
         * [Deprecated, will be removed in v0.2.0]
         * Backward-compatible string template mode. Emits a DEPRECATE warning at runtime.
         * Quotes and whitespace in the string are split as shell tokens, but variables are still
         * substituted as standalone arguments (execFile bypasses the shell).
         * New adapters should use kind: 'argv' directly.
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
// 4. Quota declarations
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
// 5. Full adapter definition
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
// 6. Runtime types
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
// 7. ctx.cliHub service interface
//    · Note: does not extend the cordis.Service base class, to avoid symbol conflicts with rc versions.
//      At runtime, ctx.set('cliHub', obj) is duck-typed.
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
// Semantically compatible as a Service
export type CliHubServiceCompat = CliHubService & Partial<Service>;
