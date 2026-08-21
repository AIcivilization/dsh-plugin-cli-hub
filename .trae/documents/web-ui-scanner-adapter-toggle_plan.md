# Web UI（Scanner 数据展示 + Adapter 开关）实施计划

## Repository Research
- 插件架构：dsh-plugin-cli-hub 通过 `Cordis ctx.set('cliHub', service)` 暴露能力，子插件通过 `mountSubPlugin()` 挂载 `src/web/index.ts`（占位实现）和 `src/cli/index.ts`。
- Web 接入机制（当前占位是**两条兼容路径**，都保留并增强）：
  1. **路径 A：`ctx.settings.registerSection`** — DSH 设置页卡片式结构（render 返回 sections；每个 section 有 refresh/enableToggle 等元数据）。适合"配置 + 轻量状态"类面板。
  2. **路径 B：`ctx.clientPages.register`** — 完整 client page（DSH 提供 Vue/React 渲染栈或"server-driven 组件树"协议）。适合带独立路由的业务面板。
- **现有后端能力**（`ctx.cliHub.*`）：
  - `scan(opts)`：返回 `ScanResult { scannedAt, depth, items[], summary }`。双形态参数：`scan('l3')` / `scan({depth, timeoutPerCmd})`。
  - `list({onlyEnabled, mode})`：拉 adapter 定义清单，含 id/name/description/fingerprint/capabilities/quota/defaultEnabled。
  - `enable(id)` / `disable(id)`：改 registry enabled 状态 + 持久化到 storage + emit `cli-hub/cli-enabled/disabled`；disable 同时 `agentGateway.stop(id)` 并 `toolGateway.unregisterForAdapter(id)`。
  - `registry.isEnabled(id)`：判断启用。
  - `scanner.on('scan-progress')`：流式进度 `{done, total, latest}`。
  - `scanner.on('cli-detected')` / `quota.*` / `agent-*` 事件均已通过 `anyCtx.emit` 转发到 ctx 总线。
- 占位现状（[src/web/index.ts](file:///Users/wf/自进化/临时/dsh-cli/src/web/index.ts)）：
  - `registerSection.render.refresh()` 返回"已发现 CLI + Agent 会话"；字段名写错：`i.installPath` 应是 `i.executablePath`，`i.displayName` 不存在；调用不存在的 `cliHub.agents.list()`（应为 `listSessions()`）。存在运行时 bug 尚未触发（因环境无 settings 接口）。
- **约束**：
  - 不锁定 DSH 设置页/客户端页的具体 UI 栈；按 plugin 能拿到的 ctx 接口做"最小可用 + 两种兼容路径"实现。
  - 插件对外不新增前端打包依赖（不引入 vite/React/Vue），DSH 的 client 侧渲染资源由 DSH runtime 提供；插件仅暴露**驱动数据**（server-driven component tree / async refresh schema / HTTP-like endpoints）。
  - 如果 DSH 提供的是"server-driven 组件树"（常见 cordis/DM 类后端 UI），我们以组件树 JSON + 后端动作路由实现；如果是 HTTP endpoints 则通过 ctx.http（或不存在时 fall back）。
  - 当前项目 package.json 没有任何前端构建依赖（React/Vue/TSX）。我们**不引入新依赖**以保持插件轻量。

## Files and Modules
- `src/web/index.ts`（**重写**）：从"占位 no-op"升级为"两条路径都真实渲染 + 动作回写 + 事件订阅"。输出：
  - `settingsSection`：Scanner 卡片（刷新、进度、深度切换）+ Adapter 卡片（列表 + 开关按钮 + 认证徽章）。
  - `clientPage`：路由 `/cli-hub`，返回 server-driven 组件树（Dashboard + 表 + Switch + ActionButton）并通过动作 id 回写 enable/disable/scan。
  - 若两个接口都不存在：降级到 `ctx.http` 路由（`GET /plugins/cli-hub/api/scan`、`POST /plugins/cli-hub/api/adapters/:id/enable` 等 RESTful JSON API），前端可被任何 DSH 外窗口 fetch。
- `src/core/types.ts`（**小改**）：补充 `ScanItem.displayName / authHint / metadataKeys` 等安全可选字段（ScanItem 目前没有 displayName，但面板需要展示 name）。或不改，在 web/index.ts 内部做投影函数（优先，减少核心合约膨胀）。
- `src/index.ts`（**小改**）：给 cliHub 聚合服务补两个只读视图 API（`ui.getDashboardSnapshot()` / `ui.toggleAdapter(id, enabled)`），避免前端拼调用散落；或不改，web 层直接调现有 API（优先不改核心门面以保持稳定）。
- `tests/p0-webui.spec.ts`（**新增**）：构造最小 ctx（含 cliHub + settings/clientPages 的 spy），`apply(webPlugin)` 后断言：
  1. `registerSection` 被调用且 `id === 'cli-hub'`。
  2. `refresh()` 输出字段名正确（`executablePath`、`displayName` 回退到 name 等）且不再引用不存在函数。
  3. 通过模拟点击 enable/disable action（或组件树 action id）间接调用 `cliHub.enable/disable`。
  4. 降级 RESTful 分支（没 settings/clientPages）下 ctx.http.route（或 fallback 的 path handlers）能返回 JSON。
- `scripts/e2e-smoke.mjs`（**小改**）：加一个 "Phase 5 Web UI 挂载" 阶段，断言 webPlugin 注册成功且能拿到 UI snapshot 的 JSON 骨架。
- `README.md`：不加，保持"用户不要求不写文档"规则。

## Implementation Steps（依赖顺序）
### Step 1：在 src/web/index.ts 中先抽出纯函数数据投影层（零运行时依赖）
- `projectScanItem(item: ScanItem, registryEnabled: (id)=>boolean): UiCliRow`
  - displayName：优先 `registry.get(item.adapterId)?.name`，否则 `item.commandName`（修掉之前对不存在字段 `displayName/installPath` 的直接引用）
  - fields: id / name / commandName / executablePath / version / authBadge（authenticated=绿色、unauthenticated=黄色、unknown=灰色、expired=红色） / enabled / capabilities（tool/agent 两个标签） / authHint
- `projectAdapters(adapters[], registryEnabled): UiAdapterRow[]` — 包括未被 scanner 发现但 registry 存在的 adapter（即"潜在/未安装" 态也展示）。
- `projectSessions(sessions[]): UiSessionRow[]` — sessionId/adapterId/pid/status/durationMs/stopAction。
- **验证**：单测里投影 claude-code ScanItem → 字段正确。

### Step 2：Settings 路径（registerSection）真实可用
- 修掉占位 3 个运行时 bug：
  1. `i.installPath` → `i.executablePath`；
  2. `i.displayName` → `registry.get(i.adapterId)?.name ?? i.commandName`；
  3. `cliHub.agents.list()` → `cliHub.agents.listSessions()`。
- "已发现的 AI CLI" section：
  - `refresh(depth?)`：调 `cliHub.scan({depth, timeoutPerCmd})` → 返回卡片行；增加 `availableActions: [{id:'cli-hub:rescan-l3', label:'重新扫描(L3)', variant:'primary'}]`。
  - 每行有 `availableActions: [{id:'cli-hub:toggle', adapterId, variant:'toggle', value: enabled}]`；若 `authState === 'unauthenticated'` 追加 `{id:'cli-hub:open-install-hint', adapterId}`。
  - 表头：名称 / 路径 / 版本 / 认证 / 额度（预留 quota percent） / 启用开关。
- "Adapter 开关（全部清单）"独立 section：
  - `refresh()` → `cliHub.list({onlyEnabled:false})` + merge 最新 lastScan 中的 version/auth；每行开关 + capabilities 标签。
  - section 级 availableActions：`['cli-hub:enable-all-authed', 'cli-hub:disable-all']`。
- "Agent 会话" section：
  - `source()` → `cliHub.agents.listSessions()`；每行 action `cli-hub:agent-stop`。
  - section 级 action `cli-hub:agent-stop-all`。
- **动作 handler**：settings 规范如果支持 section.onAction(actionId, payload) 就用；如果不支持就走 ctx.emit('cli-hub/ui-action', {id, payload}) + 在 web/apply 中订阅并派发到 cliHub.enable/disable/agents.stop/scan('l3') 等。

### Step 3：ClientPages 路径（register）— server-driven 组件树
- 如果 DSH 的 `clientPages.register` 接受 `panel: { kind:'component-tree', root: {...} }` 或类似语义（未知时做成"描述性 JSON 并加 fallback"）：
  - 渲染结构（与设置页结构对齐，但能独立路由）：
    1. Dashboard（summary cards：总数/已匹配/已启用/已认证/告警）
    2. 扫描条（深度下拉 + 刷新按钮 + 进度条）
    3. Adapter 表格（同上设置页 2 + 开关）
    4. Scanner 发现表格（同上设置页 1）
    5. Agent 会话表格（同上设置页 3）
  - 组件树节点 `actions: [{id, payload}]` 回发到同一路由；web/apply 内部订阅 ctx 的路由事件或提供 action dispatcher。
- 如果 DSH 不接受组件树（接口只认 builtin placeholder）就**不强行改契约**，先保持 placeholder；我们把真实 UI 数据通过下面的降级 HTTP API 暴露。保证用户即便走这条路径也能在前端以 fetch 拿到所有数据。

### Step 4：降级 HTTP API（settings/clientPages 都不存在时）
- 检测 ctx.http（或 ctx.router）是否存在 `ctx.http.get/post` / `ctx.router.get/post`：
  - `GET /plugins/cli-hub/api/scan?depth=l3` → `ScanResult` JSON。
  - `GET /plugins/cli-hub/api/adapters` → `UiAdapterRow[]`（含 enabled，已投影 merge lastScan）。
  - `POST /plugins/cli-hub/api/adapters/:id/enable`（body: `{enabled: boolean}`）→ 调 cliHub.enable/disable，返回 `{ok:true}`。
  - `GET /plugins/cli-hub/api/agents/sessions` → `UiSessionRow[]`。
  - `POST /plugins/cli-hub/api/agents/:adapterId/stop` → `{ok:true}`。
  - `GET /plugins/cli-hub/api/dashboard` — 汇总视图（ScanResult.summary + adapters total/启用数量 + sessions count）。
- 如果 HTTP API 也不存在：退化为**内存 API 函数导出**，供 cli 调试子命令调用（`npx cli-hub ui dashboard`），避免 UI 入口彻底断掉。

### Step 5：事件订阅（实时刷新）
- 在 web/apply 中订阅 ctx 上的转发事件（第 7 步已转发）：
  - `cli-hub/scan-progress` → 若 settings/clientPages 提供 `pushUpdate` 接口则推送；否则在下次 refresh 时自然生效 + 记录到内存 ring buffer（最多 50 条）供 HTTP `GET /plugins/cli-hub/api/scan/progress` 轮询。
  - `cli-hub/cli-enabled/disabled` → 同上。
  - `cli-hub/agent-*` → sessions 表刷新。

### Step 6：补测试 & 回归
- `tests/p0-webui.spec.ts`（vitest）：
  1. apply webPlugin + mock settings.registerSection；捕获 section，调 section.render.refresh() → 断言返回结构中没有 undefined 字段引用、行 count 与 scanner 输入对齐。
  2. emit `ui-action('cli-hub:toggle', {id:'x', enabled:false})` → spy 断言 cliHub.disable('x') 被调用一次。
  3. mock 无 settings/clientPages 但有 ctx.http 的场景；apply 后触发 `GET /plugins/cli-hub/api/adapters` → 返回 JSON。
- 调 `pnpm vitest run` + `pnpm build` + `node scripts/e2e-smoke.mjs`（已补 Phase 5）三件套全绿。

## Dependencies and Considerations
- **DSH 接口不可知**：settings/clientPages 的真实字段（settingsSection 的 action 字段名/clientPages panel 接受的格式）是未知的。策略：
  - 先按占位规范填（section.refresh + 行 availableActions + id='cli-hub:*'），字段多传不会错；运行时 DSH 不认就 fallback 到 HTTP API 兜底，三层至少一层生效。
  - 不新增前端依赖，不引入打包（避免破坏 pnpm build 现有 tsdown 双格式输出）。
- **并发/权限**：enable/disable 会写 storage + 发事件 + 可能 kill agent 进程；所有动作都是幂等（enable 重复 enable 不报错，由 registry 自行幂等处理）。
- **字段兼容性**：`ScanItem` 不增加 displayName 字段（不打破已发布的类型），UI 层用投影函数去 `registry.get(id)?.name` 回退。
- **注入声明**：web.ts 的 `inject.required: ['cliHub']`，若 DSH 注入系统不是 Cordis 标准 inject（只是 duck-typing），就 fallback 到 web/apply 开头检测：`if (!ctx.cliHub) throw`，当前占位已经通过 `(ctx as any).cliHub` 直接取，不改。

## Validation
1. `pnpm vitest run tests/p0.spec.ts tests/p0-agent.spec.ts tests/p0-webui.spec.ts` 全绿。
2. `pnpm build` 无错误；类型 `tsc --noEmit`（或 build 内置 emit）0 新增告警。
3. `node scripts/e2e-smoke.mjs` 全部 Phase 1-5 继续绿；新增 Phase 5 断言：
   - webPlugin 注册成功（settings.registerSection 被调用）。
   - 调一次 dashboard snapshot → 返回 `summary.total ≥ 1`（至少 1 个 builtin adapter）。
   - 投影后的 adapter 行至少 1 行 `id === 'claude-code'` 且 version/auth 正确。
4. （可选/用户手动）执行 install-to-dsh-web.sh 后访问 http://127.0.0.1:3080/ → 侧边栏出现"CLI Hub"，能看到 Scanner 表格 + 开关按钮，点击禁用 claude-code 会真实调用 ctx.cliHub.disable 并触发 agent-stop。

## Risks
- **Risk 高：DSH settings/clientPages 的 action 协议未知，动作点击不生效** → 处理：
  - 组件树/section 层提供 action id；同时挂 ctx 事件总线订阅（`cli-hub/ui-action`）+ 降级 HTTP 两个渠道，让前端至少能 POST。
  - README 级注释在 web/index.ts 顶部写清："若 DSH 设置页 action 回调名不是 XXXX，请替换 XXX；或直接走 REST API。"
- **Risk 中：ctx.http 路由前缀不同（DSH 可能挂 `/api/` 不是 `/plugins/`）** → 处理：
  - 先 `/cli-hub/*` + `/plugins/cli-hub/*` 两种前缀都注册。
  - 如果没有 ctx.http，返回 memory 函数（`cliHub.ui = { getDashboardSnapshot, dispatchAction }`）供 CLI/其他插件调用。
- **Risk 低：Scanner 行 count 多时 refresh 阻塞 UI** → 处理：
  - refresh 默认用上次 scan 结果 + 后台触发新 scan；scan-progress 事件推送增量更新。
  - 暴露 `GET /scan` 的 `returnCached=true` 参数（默认 true），先返回缓存结果。
- **Risk 低：enable/disable 与 storage 持久化在多用户 DSH 里冲突** → 处理：当前 scopedStorage 是 DSH scope，插件已复用 ctx.storage.scoped；若未来 DSH 提供多 user scope，仅需把 storage 层切分，UI 层无需改动。
