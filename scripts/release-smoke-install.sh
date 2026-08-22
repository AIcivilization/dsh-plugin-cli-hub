#!/usr/bin/env bash
# ============================================================
# release-smoke-install.sh
#   发布前烟雾测试：用三种通道（file:// / GitHub / npm）把本插件装到
#   一个独立的 DSH profile，然后跑 CLI 命令确认它被正确加载。
#
# 用法：
#   bash scripts/release-smoke-install.sh \
#     --gh-user YOUR_GITHUB_USERNAME \
#     [--npm-name dsh-plugin-cli-hub] \
#     [--version 0.1.0] \
#     [--profile cli-hub-release-test]
#
# 前置（请先手动执行）：
#   1. `dsh --version` 能跑通（>= 0.1.0-rc.8）
#   2. 本地 Node/pnpm OK，本仓库 `pnpm build` 已经过
#   3. --channel A（file）可以任何时候跑；B/C 需要先 push/publish
# ============================================================
set -euo pipefail

GH_USER=""
NPM_NAME="dsh-plugin-cli-hub"
VERSION="0.1.0"
PROFILE="cli-hub-release-test"
CHANNELS="A"   # 默认只跑 A（file）。B/C 要 push 后跑：--channels ABC

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gh-user)     GH_USER="$2"; shift 2;;
    --npm-name)    NPM_NAME="$2"; shift 2;;
    --version)     VERSION="$2"; shift 2;;
    --profile)     PROFILE="$2"; shift 2;;
    --channels)    CHANNELS="$2"; shift 2;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
PASS=0; FAIL=0

pass() { echo "✅ PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "❌ FAIL: $1"; FAIL=$((FAIL+1)); }
section() { echo; echo "============================================================"; echo "== $1"; echo "============================================================"; }

run_dsh() {
  # 统一加 --profile，并且给 DSH 的 node 子进程配足 PATH，避免 launchd PATH 截断
  # （DSH 有时会在子进程里清空 PATH，通过 env 显式注入常用 bin 目录。）
  PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
    dsh --profile "$PROFILE" "$@"
}

# DSH `plugin add` 子命令要求 --profile 选项放在 plugin 和 add 之间：
#   dsh plugin --profile <name> add <spec>
# 而普通子命令（cli-hub list 等）走 `dsh --profile <name> <subcommand>`。
run_dsh_plugin_add() {
  PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
    dsh plugin --profile "$PROFILE" add "$@"
}

clean_profile() {
  section "Cleaning profile $PROFILE"
  if [[ -d "$PROFILE_DIR" ]]; then
    echo "rm -rf $PROFILE_DIR"
    rm -rf "$PROFILE_DIR"
  fi
  mkdir -p "$PROFILE_DIR"
}

# DSH web profile 的 HTTP API 基地址（dsh --profile web --no-open 默认端口 3080）
# 用 HTTP API 测试代替 `dsh --profile X cli-hub list`，因为 dsh-base profile
# 启动后会变成常驻服务（web/agent loop），不会因 CLI 子命令而退出。
WEB_API="http://127.0.0.1:3080/cli-hub/api"

assert_plugin_loaded() {
  section "Assert plugin loaded (via HTTP API on web profile)"
  # 1. /scan 返回非空
  local scan_count
  scan_count="$(curl -sf "$WEB_API/scan" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$scan_count" -gt 0 ]]; then
    pass "/scan 返回 $scan_count 项"
  else
    fail "/scan 返回空或请求失败 (curl $WEB_API/scan)"
  fi

  # 2. /adapters 返回 20+
  local adapter_count
  adapter_count="$(curl -sf "$WEB_API/adapters" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$adapter_count" -ge 20 ]]; then
    pass "/adapters 返回 $adapter_count 个 adapter"
  else
    fail "/adapters 返回 $adapter_count 个 (< 20)"
  fi

  # 3. /tools 非空
  local tool_count
  tool_count="$(curl -sf "$WEB_API/tools" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$tool_count" -ge 1 ]]; then
    pass "/tools 返回 $tool_count 个工具"
  else
    fail "/tools 返回空"
  fi
}

assert_scan_ok() {
  section "Assert scan works (L1 via HTTP API)"
  local result
  result="$(curl -sf -X POST "$WEB_API/action" \
    -H "Content-Type: application/json" \
    -d '{"id":"scan","payload":{"depth":"l1"}}' 2>/dev/null || echo '')"
  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
    local matched
    matched="$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('matched',0))" 2>/dev/null)"
    pass "scan(l1) ok, matched=$matched"
  else
    fail "scan(l1) via HTTP API failed: $result"
  fi

  # adapter toggle 测试
  section "Assert adapter toggle (via HTTP API)"
  local toggle_result
  toggle_result="$(curl -sf -X POST "$WEB_API/action" \
    -H "Content-Type: application/json" \
    -d '{"id":"toggle-adapter","payload":{"adapterId":"grok","enabled":false}}' 2>/dev/null || echo '')"
  if echo "$toggle_result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
    pass "disable grok ok"
    # re-enable
    curl -sf -X POST "$WEB_API/action" \
      -H "Content-Type: application/json" \
      -d '{"id":"toggle-adapter","payload":{"adapterId":"grok","enabled":true}}' >/dev/null 2>&1
    pass "re-enable grok ok"
  else
    fail "adapter toggle failed: $toggle_result"
  fi
}

# ======================== Channel A: local file:// ========================
if [[ "$CHANNELS" == *A* ]]; then
  section "Channel A: file:// (本地安装通道)"
  clean_profile
  echo "dsh plugin --profile $PROFILE add file://$REPO_ROOT"
  if run_dsh_plugin_add "file://$REPO_ROOT"; then
    pass "add file:// 成功"
  else
    fail "add file:// 失败"
  fi
  assert_plugin_loaded
  assert_scan_ok
fi

# ======================== Channel B: GitHub ========================
if [[ "$CHANNELS" == *B* ]]; then
  if [[ -z "$GH_USER" ]]; then
    fail "Channel B 需要 --gh-user"
  else
    section "Channel B: GitHub (github:$GH_USER/dsh-plugin-cli-hub@v$VERSION)"
    clean_profile
    SPEC="github:$GH_USER/dsh-plugin-cli-hub#v$VERSION"
    if run_dsh_plugin_add "$SPEC"; then
      pass "GitHub 安装成功 ($SPEC)"
    else
      fail "GitHub 安装失败 ($SPEC)"
    fi
    assert_plugin_loaded
  fi
fi

# ======================== Channel C: npm ========================
if [[ "$CHANNELS" == *C* ]]; then
  section "Channel C: npm (npm:$NPM_NAME@$VERSION)"
  clean_profile
  if run_dsh_plugin_add "npm:$NPM_NAME@$VERSION"; then
    pass "npm 安装成功 (npm:$NPM_NAME@$VERSION)"
  else
    fail "npm 安装失败"
  fi
  assert_plugin_loaded
fi

# ======================== Summary ========================
echo
echo "============================================================"
echo " 结果：PASS=$PASS  FAIL=$FAIL"
echo "============================================================"
if [[ $FAIL -gt 0 ]]; then
  echo ">> 有失败项，请查看上面的 ❌ 标记。临时文件："
  echo "   /tmp/dsh-clihub-list.log"
  echo "   /tmp/dsh-clihub-scan.log"
  exit 1
fi
echo ">> 全部通过 ✅"
exit 0
