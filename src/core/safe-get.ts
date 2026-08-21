/**
 * 安全读取 Cordis ctx 上的属性：规避 inject 白名单拦截。
 *
 * 背景：Cordis v4 的 Context 是 Proxy。任何未声明在 inject 数组中的属性名，
 * 通过 `anyCtx.name` 直接读都会被 proxy trap 拦截并抛出
 * 「cannot get property "<name>" without inject」。这对可选依赖 / 后激活服务
 * （webServer / settings / subprocess 等）非常不友好，因为：
 *   1) 你不想把它们写进 inject（因为 headless mode 下可选，会阻塞 fiber pending）
 *   2) 你需要 `if (ctx.xxx) …` 的存在性检测，但一访问就炸
 *
 * 本函数全链路 try/catch，按可靠性从强到弱探测 6 条路径。对不存在服务正常返回 undefined。
 * Cordis rc 版对 `reflect.get(name, false)` 在某些 fiber 状态下仍会抛错，所以这里
 * 每条路径都独立 try/catch，单条失败不影响其它。
 */
export function safeGetCtx(ctx: any, name: string): any {
  if (!ctx) return undefined;

  // 路径 0：proxy 后端对象（internal / raw / root / service）—— 直接读绕过 trap
  try {
    const raw: any = (ctx as any).internal ?? (ctx as any).raw ?? (ctx as any).root ?? undefined;
    if (raw && raw !== null && typeof raw === 'object') {
      if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];
    }
    const svc: any = (ctx as any).service;
    if (svc && svc !== null && typeof svc === 'object') {
      if (Object.prototype.hasOwnProperty.call(svc, name)) return svc[name];
    }
  } catch { /* proxy trap 也可能在 .internal 访问上触发；忽略 */ }

  // 路径 1：Context.get(name, required=false) — DSH/新版 Cordis 提供
  try {
    const c: any = ctx;
    if (c !== null && typeof c.get === 'function') {
      const v = c.get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}

  // 路径 2：ctx.reflect.get(name, false) — Cordis 官方 bypass，但 rc.8 部分状态仍会抛
  try {
    const ref: any = (ctx as any).reflect;
    if (ref !== null && ref !== undefined && typeof ref.get === 'function') {
      const v = ref.get(name, false);
      if (v !== undefined) return v;
    }
  } catch {}

  // 路径 3：runtime.services / fiber.runtime.services map
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

  // 路径 4：最后裸读（非 Cordis 环境 / headless）
  try {
    const v = ctx[name];
    if (v !== undefined) return v;
  } catch {}

  return undefined;
}

export default safeGetCtx;
