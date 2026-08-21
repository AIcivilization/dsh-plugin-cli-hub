/**
 * 内置 adapter 注册中心
 *
 * 列表共 21 个 adapter：
 *   - 原 4 个：snow-cli / officecli / kimi-cli / claude-code
 *   - 新增 17 个：codex / gemini-cli / aider / cline / continue / opencode / goose
 *                 / cursor-cli / junie / windsurf / aichat / tgpt / ollama / litellm
 *                 / grok / qwen / trae
 */
import type { RegistryService } from '../../core/registry';
import { snowCliAdapter } from './snow-cli';
import { officeCliAdapter } from './officecli';
import { kimiCliAdapter } from './kimi-cli';
import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { geminiCliAdapter } from './gemini-cli';
import { aiderAdapter } from './aider';
import { clineAdapter } from './cline';
import { continueAdapter } from './continue';
import { opencodeAdapter } from './opencode';
import { gooseAdapter } from './goose';
import { cursorCliAdapter } from './cursor-cli';
import { junieAdapter } from './junie';
import { windsurfAdapter } from './windsurf';
import { aichatAdapter } from './aichat';
import { tgptAdapter } from './tgpt';
import { ollamaAdapter } from './ollama';
import { litellmAdapter } from './litellm';
import { grokAdapter } from './grok';
import { qwenAdapter } from './qwen';
import { traeAdapter } from './trae';

export const BUILTIN_ADAPTERS = [
  // === 原 4 个 ===
  snowCliAdapter,
  officeCliAdapter,
  kimiCliAdapter,
  claudeCodeAdapter,
  // === 新增 17 个 ===
  codexAdapter,
  geminiCliAdapter,
  aiderAdapter,
  clineAdapter,
  continueAdapter,
  opencodeAdapter,
  gooseAdapter,
  cursorCliAdapter,
  junieAdapter,
  windsurfAdapter,
  aichatAdapter,
  tgptAdapter,
  ollamaAdapter,
  litellmAdapter,
  grokAdapter,
  qwenAdapter,
  traeAdapter,
] as const;

export function loadBuiltinAdapters(registry: RegistryService): void {
  for (const a of BUILTIN_ADAPTERS) {
    try {
      registry.register(a as any);
    } catch (e: any) {
      console.warn(`[cli-hub] builtin adapter ${a.id} failed to register:`, e?.message ?? e);
    }
  }
}
