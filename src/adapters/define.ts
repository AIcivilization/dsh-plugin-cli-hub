/**
 * defineCliAdapter — a type-friendly factory for built-in and third-party adapter authors.
 *
 * Main purposes:
 *   · Provide TypeScript type inference (no need to write generics manually)
 *   · Perform lightweight runtime validation at definition time (complements Registry._assertValidAdapter)
 *
 * Usage example:
 *   export const snowCliAdapter = defineCliAdapter({
 *     id: 'snow-cli', name: 'Snow CLI', description: 'Drawing, translation, voice',
 *     fingerprint: { commandNames: ['snow'], ... },
 *     capabilities: { tools: [ ... ] },
 *   });
 */
import type { CliAdapterDefinition } from '../core/types';

export function defineCliAdapter<T extends CliAdapterDefinition>(def: T): T {
  // Lightweight runtime validation (throw on failure to prevent adapter definition from being broken)
  if (!def.id || !/^[a-z0-9-]{2,64}$/.test(def.id))
    throw new TypeError(`[defineCliAdapter] invalid id: ${def.id}`);
  if (!def.name || !def.description)
    throw new TypeError(`[defineCliAdapter] ${def.id}: name/description are required`);
  if (!def.fingerprint?.commandNames?.length)
    throw new TypeError(`[defineCliAdapter] ${def.id}: fingerprint.commandNames is empty`);
  const caps = def.capabilities;
  if (!caps.tools?.length && !caps.agent)
    throw new TypeError(`[defineCliAdapter] ${def.id}: capabilities requires tool or agent`);
  return def;
}
