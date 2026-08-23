/**
 * Safely read properties from the Cordis ctx, bypassing the inject allowlist interception.
 *
 * Background: Cordis v4's Context is a Proxy. Any property name not declared in the
 * inject array will be intercepted by the proxy trap when read directly via `anyCtx.name`,
 * throwing "cannot get property \"<name>\" without inject". This is very unfriendly to
 * optional dependencies / lazily activated services (webServer / settings / subprocess, etc.):
 *   1) You don't want them in inject (they're optional in headless mode and would block fiber pending)
 *   2) You need existence checks like `if (ctx.xxx) …`, but the moment you access it, it throws
 *
 * This function wraps the whole chain in try/catch, probing 6 paths from most to least reliable.
 * It returns undefined for nonexistent services.
 * Cordis rc versions can still throw on `reflect.get(name, false)` in certain fiber states,
 * so each path has its own independent try/catch; a single failure doesn't affect the others.
 */
export function safeGetCtx(ctx: any, name: string): any {
  if (!ctx) return undefined;

  // Path 0: proxy backend objects (internal / raw / root / service) — read directly to bypass the trap
  try {
    const raw: any = (ctx as any).internal ?? (ctx as any).raw ?? (ctx as any).root ?? undefined;
    if (raw && raw !== null && typeof raw === 'object') {
      if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];
    }
    const svc: any = (ctx as any).service;
    if (svc && svc !== null && typeof svc === 'object') {
      if (Object.prototype.hasOwnProperty.call(svc, name)) return svc[name];
    }
  } catch { /* the proxy trap may also fire on .internal access; ignore */ }

  // Path 1: Context.get(name, required=false) — provided by DSH/newer Cordis
  try {
    const c: any = ctx;
    if (c !== null && typeof c.get === 'function') {
      const v = c.get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}

  // Path 2: ctx.reflect.get(name, false) — Cordis's official bypass, but rc.8 still throws in some states
  try {
    const ref: any = (ctx as any).reflect;
    if (ref !== null && ref !== undefined && typeof ref.get === 'function') {
      const v = ref.get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}

  // Path 3: runtime.services / fiber.runtime.services map
  try {
    const c: any = ctx;
    let rts: any = undefined;
    try { if (c.runtime !== undefined && c.runtime !== null) rts = c.runtime; } catch {}
    try {
      if (!rts) {
        const fiber = c.fiber;
        if (fiber !== null && fiber !== undefined && fiber.runtime !== undefined) rts = fiber.runtime;
      }
    } catch {}
    if (rts && typeof rts === 'object') {
      let map: any = undefined;
      try { if (rts.services !== undefined) map = rts.services; } catch {}
      try { if (!map && rts._services !== undefined) map = rts._services; } catch {}
      if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, name)) {
        const entry = map[name];
        if (entry !== null && entry !== undefined && typeof entry === 'object' && entry.value !== undefined) return entry.value;
        if (entry !== undefined) return entry;
      }
    }
  } catch {}

  // Path 4: last resort, a bare read (non-Cordis environment / headless)
  try {
    const v = ctx[name];
    if (v !== undefined) return v;
  } catch {}

  return undefined;
}

export default safeGetCtx;
