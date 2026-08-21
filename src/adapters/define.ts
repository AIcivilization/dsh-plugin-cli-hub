/**
 * defineCliAdapter —— 供内置和第三方 adapter 作者使用的类型友好工厂。
 *
 * 主要作用：
 *   · 提供 TypeScript 类型推断（不用手写泛型）
 *   · 在定义期做轻量级 runtime 校验（和 Registry._assertValidAdapter 互补）
 *
 * 使用示例：
 *   export const snowCliAdapter = defineCliAdapter({
 *     id: 'snow-cli', name: 'Snow CLI', description: '画图翻译语音',
 *     fingerprint: { commandNames: ['snow'], ... },
 *     capabilities: { tools: [ ... ] },
 *   });
 */
import type { CliAdapterDefinition } from '../core/types';

export function defineCliAdapter<T extends CliAdapterDefinition>(def: T): T {
  // 运行期轻校验（失败直接抛，防止 adapter 定义就挂）
  if (!def.id || !/^[a-z0-9-]{2,64}$/.test(def.id))
    throw new TypeError(`[defineCliAdapter] id 非法: ${def.id}`);
  if (!def.name || !def.description)
    throw new TypeError(`[defineCliAdapter] ${def.id}: name/description 必填`);
  if (!def.fingerprint?.commandNames?.length)
    throw new TypeError(`[defineCliAdapter] ${def.id}: fingerprint.commandNames 空`);
  const caps = def.capabilities;
  if (!caps.tools?.length && !caps.agent)
    throw new TypeError(`[defineCliAdapter] ${def.id}: capabilities 需要 tool 或 agent`);
  return def;
}
