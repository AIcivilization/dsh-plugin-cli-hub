/**
 * Built-in adapter registry
 *
 * 33 adapters in total:
 *   - Original 4: snow-cli / officecli / kimi-cli / claude-code
 *   - Second batch of 17: codex / gemini-cli / aider / cline / continue / opencode / goose
 *                  / cursor-cli / junie / windsurf / aichat / tgpt / ollama / litellm
 *                  / grok / qwen / trae
 *   - Third batch of 12 (locally discovered CLIs + the open-source ecosystem):
 *                  copilot / hermes / paperclipai / freebuff / soul5 / devin-desktop
 *                  / catpawai / llm / gptme / chatblade / smol / openclaudia
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
import { copilotAdapter } from './copilot';
import { hermesAdapter } from './hermes';
import { paperclipaiAdapter } from './paperclipai';
import { freebuffAdapter } from './freebuff';
import { soul5Adapter } from './soul5';
import { devinDesktopAdapter } from './devin-desktop';
import { catpawaiAdapter } from './catpawai';
import { llmAdapter } from './llm';
import { gptmeAdapter } from './gptme';
import { chatbladeAdapter } from './chatblade';
import { smolAdapter } from './smol';
import { openclaudiaAdapter } from './openclaudia';

export const BUILTIN_ADAPTERS = [
  // === Original 4 ===
  snowCliAdapter,
  officeCliAdapter,
  kimiCliAdapter,
  claudeCodeAdapter,
  // === Second batch of 17 ===
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
  // === Third batch of 12 (locally discovered + open-source ecosystem) ===
  copilotAdapter,
  hermesAdapter,
  paperclipaiAdapter,
  freebuffAdapter,
  soul5Adapter,
  devinDesktopAdapter,
  catpawaiAdapter,
  llmAdapter,
  gptmeAdapter,
  chatbladeAdapter,
  smolAdapter,
  openclaudiaAdapter,
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
