/**
 * CLI Hub self-contained Web Dashboard
 *
 * Pure static page returned directly by the webServer exact route `GET /cli-hub`.
 * Zero external dependencies (no CDN / no framework); all data comes from this
 * plugin's verified REST endpoints:
 *
 *   GET  /cli-hub/api/dashboard          summary cards
 *   GET  /cli-hub/api/scan?depth=l1|l3   trigger a scan and return rows (L3 really executes commands, slower)
 *   GET  /cli-hub/api/adapters           all built-in adapters (with discovered/enabled)
 *   GET  /cli-hub/api/quota              quota rows
 *   GET  /cli-hub/api/tools              tool rows
 *   GET  /cli-hub/api/agents/sessions    agent session rows
 *   POST /cli-hub/api/action             generic action dispatch { id, payload }
 *
 * Note: this file is a TS template string; the embedded JS uses single quotes and
 * string concatenation only — no backticks and no ${ — to avoid escaping issues.
 */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CLI Hub &middot; dsh-plugin-cli-hub</title>
<style>
  :root {
    --bg: #0b1120; --panel: #101a2e; --panel2: #16223c; --border: #22304f;
    --text: #dbe4f3; --muted: #8294b4; --accent: #38bdf8; --accent2: #0ea5e9;
    --ok: #34d399; --warn: #fbbf24; --bad: #f87171;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text); min-height: 100vh;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 14px;
    padding: 20px clamp(12px, 4vw, 40px) 60px;
  }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 18px; }
  h1 { font-size: 22px; letter-spacing: .5px; }
  h1 .dot { color: var(--accent); }
  .sub { color: var(--muted); font-size: 12px; }
  .hdr-right { margin-left: auto; display: flex; gap: 10px; align-items: center; }
  label.auto { color: var(--muted); font-size: 12px; cursor: pointer; user-select: none; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card {
    background: linear-gradient(180deg, var(--panel), var(--panel2));
    border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
  }
  .card .k { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  .card .v { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card .v.ok { color: var(--ok); } .card .v.acc { color: var(--accent); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
  .status { color: var(--muted); font-size: 12px; margin-left: 6px; }
  button {
    background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 14px; cursor: pointer; font-size: 13px;
    transition: all .15s ease; font-family: inherit;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .45; cursor: wait; }
  button.primary { background: var(--accent2); border-color: var(--accent2); color: #04121f; font-weight: 600; }
  button.primary:hover { filter: brightness(1.15); color: #04121f; }
  button.danger { color: var(--bad); } button.danger:hover { border-color: var(--bad); }
  button.sm { padding: 3px 9px; font-size: 12px; border-radius: 6px; }
  section.panel {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 16px;
  }
  section.panel > h2 { font-size: 15px; margin-bottom: 4px; }
  section.panel > p.hint { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
  .tbl-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: top; }
  td.wrap { white-space: normal; word-break: break-all; max-width: 380px; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; position: sticky; top: 0; background: var(--panel); }
  tbody tr:hover { background: rgba(56,189,248,.05); }
  tr:last-child td { border-bottom: none; }
  .empty { color: var(--muted); padding: 14px 4px; font-size: 13px; }
  .badge { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; border: 1px solid transparent; }
  .badge.success { color: var(--ok); border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.08); }
  .badge.warning { color: var(--warn); border-color: rgba(251,191,36,.45); background: rgba(251,191,36,.08); }
  .badge.danger  { color: var(--bad); border-color: rgba(248,113,113,.45); background: rgba(248,113,113,.08); }
  .badge.muted   { color: var(--muted); border-color: var(--border); background: transparent; }
  .tag { display: inline-block; padding: 1px 8px; margin: 1px 3px 1px 0; border-radius: 5px; font-size: 11px; color: var(--accent); border: 1px solid rgba(56,189,248,.35); background: rgba(56,189,248,.07); }
  .rowbtns { display: flex; gap: 6px; flex-wrap: wrap; }
  code.path { color: var(--muted); font-size: 11px; font-family: Consolas, monospace; }
  #toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 99; max-width: min(480px, 90vw); }
  .toast {
    background: var(--panel2); border: 1px solid var(--border); border-left: 3px solid var(--accent);
    border-radius: 8px; padding: 10px 14px; font-size: 13px; box-shadow: 0 6px 24px rgba(0,0,0,.45);
    animation: slidein .18s ease; word-break: break-all;
  }
  .toast.err { border-left-color: var(--bad); }
  .toast.okk { border-left-color: var(--ok); }
  @keyframes slidein { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  dialog#detail {
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px; width: min(720px, 92vw);
  }
  dialog::backdrop { background: rgba(2,6,17,.7); }
  dialog pre { background: #0a1224; border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow: auto; max-height: 55vh; font-size: 12px; line-height: 1.5; }
  dialog h3 { margin-bottom: 10px; font-size: 15px; }
  dialog .dlg-foot { margin-top: 12px; text-align: right; }
  .spin { display: inline-block; width: 13px; height: 13px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; animation: rot .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
  @keyframes rot { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header>
  <h1><span class="dot">&#9679;</span> CLI Hub</h1>
  <span class="sub">DeepSeek Harness &middot; local AI CLI integration &amp; quota management &middot; dsh-plugin-cli-hub</span>
  <div class="hdr-right">
    <label class="auto"><input type="checkbox" id="autoRefresh"> Auto refresh (30s)</label>
    <button class="sm" id="btnReloadAll">Refresh data</button>
  </div>
</header>

<div class="cards" id="cards"></div>

<div class="toolbar">
  <button id="btnScanL1">Quick scan (L1)</button>
  <button id="btnScanL3" class="primary">Deep scan (L3)</button>
  <button id="btnEnableAuthed">Enable all authed</button>
  <button id="btnDisableAll" class="danger">Disable all</button>
  <button id="btnQuotaAll">Refresh all quotas</button>
  <span class="status" id="statusText"></span>
</div>

<section class="panel">
  <h2>Discovered AI CLIs</h2>
  <p class="hint">Scanning actually probes local commands: L1 checks file names only (~20ms); L3 adds version and login-state probes (subprocesses + network, a few seconds). Click a button above to start.</p>
  <div class="tbl-wrap"><table id="t-scan"></table></div>
</section>

<section class="panel">
  <h2>Adapter toggles (all built-in)</h2>
  <p class="hint">33 built-in adapters. Disabling stops the corresponding agent subprocesses and unregisters that CLI's tools from DSH. Click a name for details.</p>
  <div class="tbl-wrap"><table id="t-adapters"></table></div>
</section>

<section class="panel">
  <h2>Quota monitoring</h2>
  <p class="hint">Per-adapter quota usage for enabled adapters; a source of estimate means a locally estimated value.</p>
  <div class="tbl-wrap"><table id="t-quota"></table></div>
</section>

<section class="panel">
  <h2>Available tools</h2>
  <p class="hint">Tools exposed to the DSH Agent by discovered + authenticated CLIs (invoked automatically in conversation).</p>
  <div class="tbl-wrap"><table id="t-tools"></table></div>
</section>

<section class="panel">
  <h2>Agent sessions</h2>
  <p class="hint" style="display:flex;justify-content:space-between;align-items:center;">
    <span>Long-lived agent subprocesses; stop uses graceful shutdown (SIGINT&rarr;SIGTERM&rarr;SIGKILL).</span>
    <button class="sm danger" id="btnStopAllAgents">Stop all</button>
  </p>
  <div class="tbl-wrap"><table id="t-agents"></table></div>
</section>

<dialog id="detail">
  <h3 id="detailTitle">Details</h3>
  <pre id="detailBody"></pre>
  <div class="dlg-foot"><button onclick="document.getElementById('detail').close()">Close</button></div>
</dialog>

<div id="toasts"></div>

<script>
'use strict';
var $ = function (s) { return document.querySelector(s); };
var API = '/cli-hub/api';

/* ---------- helpers ---------- */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toast(msg, kind) {
  var box = document.createElement('div');
  box.className = 'toast' + (kind === 'err' ? ' err' : kind === 'okk' ? ' okk' : '');
  box.textContent = msg;
  $('#toasts').appendChild(box);
  setTimeout(function () { box.remove(); }, kind === 'err' ? 8000 : 4000);
}
function fmtTime(ts) {
  if (!ts) return '-';
  try { return new Date(Number(ts)).toLocaleTimeString(undefined, { hour12: false }); } catch (e) { return '-'; }
}
function authBadge(auth, label) {
  var map = { authenticated: 'success', unauthenticated: 'warning', expired: 'danger', unknown: 'muted' };
  var cls = map[auth] || 'muted';
  return '<span class="badge ' + cls + '">' + esc(label || auth || 'unknown') + '</span>';
}
function capsTags(caps) {
  if (!caps || !caps.length) return '<span class="badge muted">-</span>';
  var out = '';
  for (var i = 0; i < caps.length; i++) out += '<span class="tag">' + esc(caps[i]) + '</span>';
  return out;
}
function yesno(v) { return v ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--muted)">✗</span>'; }
function busy(btn, on) { if (btn) btn.disabled = !!on; }
function setStatus(html) { $('#statusText').innerHTML = html || ''; }

async function api(path, opts) {
  var r = await fetch(API + path, opts);
  var ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('HTTP ' + r.status + ' (non-json)');
  var j = await r.json();
  if (!r.ok) throw new Error(j && j.message ? j.message : ('HTTP ' + r.status));
  return j;
}
async function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}
/* dispatch through the generic action endpoint; returns {ok,message,data} */
async function act(id, payload) {
  try {
    var res = await post('/action', { id: id, payload: payload || {} });
    toast(res.message || (res.ok ? 'Done' : 'Action failed'), res.ok ? 'okk' : 'err');
    return res;
  } catch (e) { toast(String(e.message || e), 'err'); return { ok: false }; }
}

/* ---------- rendering ---------- */
/* Per-CLI login entry point: open the web login page when the adapter declares one,
   otherwise show the terminal command / guidance in a dialog. */
function showLoginDialog(d) {
  var opened = false;
  if (d.url) {
    try { window.open(d.url, '_blank', 'noopener'); opened = true; } catch (e) {}
  }
  var lines = [];
  if (d.note) lines.push(d.note);
  if (d.cmd) lines.push('Run in a terminal:\n\n    ' + d.cmd);
  if (!d.url && !d.cmd && !d.note) lines.push('No automated login known for this CLI.');
  if (d.installHint) lines.push('Install: ' + d.installHint);
  if (d.officialDoc) lines.push('Docs: ' + d.officialDoc);
  lines.push('\nAfter logging in, click "Deep scan (L3)" to refresh the status here.');
  $('#detailTitle').textContent = 'Log in · ' + (d.name || d.adapterId || '');
  $('#detailBody').textContent = lines.join('\n\n');
  document.getElementById('detail').showModal();
}

function emptyRow(cols, text) {
  return '<tr><td colspan="' + cols + '" class="empty">' + esc(text || 'No data') + '</td></tr>';
}

function renderCards(d) {
  var s = d.summary || {};
  var items = [
    ['Discovered CLIs', s.total, ''], ['Matched adapters', s.matched, 'acc'],
    ['Authenticated', s.authenticated, 'ok'], ['Enabled', s.enabled, ''],
    ['Agent sessions', d.sessionsCount, 'acc'], ['Total adapters', d.adaptersTotal, '']
  ];
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += '<div class="card"><div class="k">' + items[i][0]
      + '</div><div class="v ' + items[i][2] + '">' + esc(items[i][1] === undefined ? '-' : items[i][1])
      + '</div></div>';
  }
  $('#cards').innerHTML = html;
  setStatus('Last scan: ' + (d.scannedAt ? new Date(d.scannedAt).toLocaleString(undefined, { hour12: false }) : 'never')
    + ' &middot; depth ' + esc(d.depth || '-'));
}

function actionBtns(actions) {
  if (!actions || !actions.length) return '';
  var out = '<div class="rowbtns">';
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    var cls = a.variant === 'danger' ? ' sm danger' : ' sm';
    out += '<button class="act' + cls + '" data-aid="' + esc(a.id) + '" data-payload="'
      + esc(JSON.stringify(a.payload || {})) + '">' + esc(a.label || a.id) + '</button>';
  }
  return out + '</div>';
}

function renderScanTable(rows) {
  var t = $('#t-scan');
  if (!rows || !rows.length) { t.innerHTML = '<thead></thead><tbody>' + emptyRow(6, 'Not scanned yet — click "Quick scan" or "Deep scan" above') + '</tbody>'; return; }
  var h = '<thead><tr><th>Name</th><th>Version</th><th>Auth</th><th>Capabilities</th><th>Path</th><th>Actions</th></tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    h += '<tr><td>' + esc(r.displayName) + (r.commandName !== r.displayName ? ' <code class="path">(' + esc(r.commandName) + ')</code>' : '')
      + '</td><td>' + esc(r.version || '-')
      + '</td><td>' + authBadge(r.auth, r.authBadge && r.authBadge.label)
      + '</td><td>' + capsTags(r.capabilities)
      + '</td><td class="wrap"><code class="path">' + esc(r.executablePath) + '</code>'
      + '</td><td>' + actionBtns(r.actions) + '</td></tr>';
  }
  t.innerHTML = h + '</tbody>';
}

function renderAdapterTable(rows) {
  var t = $('#t-adapters');
  if (!rows || !rows.length) { t.innerHTML = '<thead></thead><tbody>' + emptyRow(8) + '</tbody>'; return; }
  var h = '<thead><tr><th>Adapter</th><th>Vendor</th><th>Installed</th><th>Version</th><th>Auth</th><th>Capabilities</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    h += '<tr><td><a href="#" class="alink" data-id="' + esc(r.id) + '" style="color:var(--accent);text-decoration:none">'
      + esc(r.name) + '</a><div style="color:var(--muted);font-size:11px">' + esc(r.description) + '</div></td>'
      + '<td>' + esc(r.vendor || '-') + '</td>'
      + '<td>' + yesno(r.discovered) + '</td>'
      + '<td>' + esc(r.version || '-') + '</td>'
      + '<td>' + (r.auth ? authBadge(r.auth, r.authBadge && r.authBadge.label) : '<span class="badge muted">not scanned</span>') + '</td>'
      + '<td>' + capsTags(r.capabilities) + '</td>'
      + '<td>' + yesno(r.enabled) + '</td>'
      + '<td>' + actionBtns(r.actions) + '</td></tr>';
  }
  t.innerHTML = h + '</tbody>';
}

function renderQuotaTable(rows) {
  var t = $('#t-quota');
  if (!rows || !rows.length) { t.innerHTML = '<thead></thead><tbody>' + emptyRow(9, 'No quota data yet (adapters must be enabled and provide a quota method)') + '</tbody>'; return; }
  var h = '<thead><tr><th>Adapter</th><th>Used</th><th>Total</th><th>Remaining</th><th>Usage</th><th>Unit</th><th>Source</th><th>Refreshed</th><th>Actions</th></tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var pct = (r.percent === null || r.percent === undefined) ? '-' : (r.percent + '%');
    var pctStyle = (r.percent !== null && r.percent !== undefined && r.percent >= 80) ? 'style="color:var(--bad)"'
      : ((r.percent !== null && r.percent !== undefined && r.percent >= 60) ? 'style="color:var(--warn)"' : '');
    h += '<tr><td>' + esc(r.adapterName) + (r.warning ? ' <span class="badge warning">warn</span>' : '')
      + '</td><td>' + esc(r.used) + '</td><td>' + esc(r.total === null || r.total === undefined ? '∞' : r.total)
      + '</td><td>' + esc(r.remaining === null || r.remaining === undefined ? '-' : r.remaining)
      + '</td><td ' + pctStyle + '>' + pct + '</td><td>' + esc(r.currency || '-')
      + '</td><td>' + esc(r.source || '-') + '</td><td>' + fmtTime(r.refreshedAt)
      + '</td><td><div class="rowbtns"><button class="sm qref" data-id="' + esc(r.adapterId) + '">Refresh</button></div></td></tr>';
  }
  t.innerHTML = h + '</tbody>';
}

function renderToolTable(rows) {
  var t = $('#t-tools');
  if (!rows || !rows.length) { t.innerHTML = '<thead></thead><tbody>' + emptyRow(5, 'No tools yet (requires installed + authenticated CLIs)') + '</tbody>'; return; }
  var h = '<thead><tr><th>Tool name</th><th>Source</th><th>Description</th><th>Est. credits</th><th>Enabled</th></tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    h += '<tr><td><code class="path">' + esc(r.toolName) + '</code></td><td>' + esc(r.adapterName)
      + '</td><td class="wrap">' + esc(r.description) + '</td><td>' + esc(r.estimatedCredits || 0)
      + '</td><td>' + yesno(r.enabled) + '</td></tr>';
  }
  t.innerHTML = h + '</tbody>';
}

function renderAgentTable(rows) {
  var t = $('#t-agents');
  if (!rows || !rows.length) { t.innerHTML = '<thead></thead><tbody>' + emptyRow(7, 'No live agent subprocesses') + '</tbody>'; return; }
  var h = '<thead><tr><th>Adapter</th><th>PID</th><th>Status</th><th>Protocol</th><th>Uptime</th><th>SessionId</th><th>Actions</th></tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    h += '<tr><td>' + esc(r.adapterName) + '</td><td>' + esc(r.pid || '-') + '</td><td>'
      + esc(r.status) + '</td><td>' + esc(r.protocol || '-') + '</td><td>'
      + Math.round((r.durationMs || 0) / 1000) + 's</td><td><code class="path">' + esc(r.sessionId) + '</code></td>'
      + '<td>' + actionBtns(r.actions) + '</td></tr>';
  }
  t.innerHTML = h + '</tbody>';
}

/* ---------- data loading ---------- */
async function loadDashboard() {
  try { renderCards(await api('/dashboard')); }
  catch (e) { toast('Failed to load dashboard: ' + e.message, 'err'); }
}
async function loadAdapters() {
  try { renderAdapterTable(await api('/adapters')); }
  catch (e) { toast('Failed to load adapters: ' + e.message, 'err'); }
}
async function loadQuota() {
  try { renderQuotaTable(await api('/quota')); }
  catch (e) { /* silent: the quota endpoint may have no data */ renderQuotaTable([]); }
}
async function loadTools() {
  try { renderToolTable(await api('/tools')); }
  catch (e) { renderToolTable([]); }
}
async function loadSessions() {
  try { renderAgentTable(await api('/agents/sessions')); }
  catch (e) { renderAgentTable([]); }
}
async function loadLight() {
  await Promise.all([loadDashboard(), loadAdapters(), loadQuota(), loadTools(), loadSessions()]);
}

async function doScan(depth, btn) {
  busy(btn, true);
  setStatus('<span class="spin"></span>Scanning (L' + depth.slice(1) + '), please wait…');
  try {
    var rows = await api('/scan?depth=' + depth, { method: 'GET' });
    renderScanTable(rows);
    toast('Scan finished: ' + rows.length + ' row(s)', 'okk');
  } catch (e) {
    toast('Scan failed: ' + (e.message || e), 'err');
  } finally {
    busy(btn, false);
    await loadDashboard(); await loadAdapters(); await loadTools();
  }
}

/* ---------- events ---------- */
$('#btnScanL1').addEventListener('click', function () { doScan('l1', this); });
$('#btnScanL3').addEventListener('click', function () { doScan('l3', this); });
$('#btnReloadAll').addEventListener('click', function () { var b = this; busy(b, true); loadLight().then(function () { busy(b, false); }); });
$('#btnStopAllAgents').addEventListener('click', async function () { var r = await act('agent-stop-all'); if (r.ok) loadSessions(); });

$('#btnEnableAuthed').addEventListener('click', async function () {
  var b = this; busy(b, true);
  var r = await act('enable-all-authed');
  busy(b, false);
  if (r.ok) { await loadAdapters(); await loadTools(); await loadDashboard(); }
});
$('#btnDisableAll').addEventListener('click', async function () {
  var b = this; busy(b, true);
  var r = await act('disable-all');
  busy(b, false);
  if (r.ok) { await loadAdapters(); await loadTools(); await loadSessions(); await loadDashboard(); }
});
$('#btnQuotaAll').addEventListener('click', async function () {
  var b = this; busy(b, true);
  var r = await act('quota-refresh-all');
  busy(b, false);
  if (r.ok) loadQuota();
});

/* inline action buttons rendered from actions arrays: toggle-adapter etc. */
document.addEventListener('click', async function (ev) {
  var btn = ev.target.closest ? ev.target.closest('button.act') : null;
  if (btn) {
    var aid = btn.getAttribute('data-aid');
    var payload = {};
    try { payload = JSON.parse(btn.getAttribute('data-payload') || '{}'); } catch (e) {}
    busy(btn, true);
    var r = await act(aid, payload);
    busy(btn, false);
    if (r.ok && aid === 'cli-login') { showLoginDialog(r.data || {}); return; }
    if (r.ok) {
      if (aid === 'toggle-adapter' || aid === 'enable-all-authed' || aid === 'disable-all') {
        await Promise.all([loadAdapters(), loadTools(), loadDashboard()]);
      } else if (aid === 'agent-stop') { loadSessions(); }
    }
    return;
  }
  var qr = ev.target.closest ? ev.target.closest('button.qref') : null;
  if (qr) {
    var id = qr.getAttribute('data-id');
    busy(qr, true);
    var r2 = await act('quota-refresh', { adapterId: id });
    busy(qr, false);
    if (r2.ok) loadQuota();
    return;
  }
  var al = ev.target.closest ? ev.target.closest('a.alink') : null;
  if (al) {
    ev.preventDefault();
    var adid = al.getAttribute('data-id');
    try {
      var detail = await api('/adapters/' + encodeURIComponent(adid));
      $('#detailTitle').textContent = 'Adapter details · ' + (detail.name || adid);
      $('#detailBody').textContent = JSON.stringify(detail, null, 2);
      document.getElementById('detail').showModal();
    } catch (e) { toast('Failed to fetch details: ' + (e.message || e), 'err'); }
  }
});

/* auto refresh (lightweight endpoints only, never triggers a scan) */
setInterval(function () {
  if ($('#autoRefresh').checked) loadLight();
}, 30000);

/* first paint: light data only, no automatic scan */
loadLight();
renderScanTable([]);
/* if this install has never been scanned, run one cheap L1 automatically so the
   user sees their CLIs right away instead of an empty panel (L3 stays manual) */
(async function autoFirstScan() {
  try {
    var d = await api('/dashboard');
    if (!d || !d.scannedAt) doScan('l1', $('#btnScanL1'));
  } catch (e) { /* dashboard unreachable; nothing sensible to do here */ }
})();
</script>
</body>
</html>`;
