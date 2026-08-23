#!/usr/bin/env bash
# ============================================================
# release-smoke-install.sh
#   Pre-release smoke test: installs this plugin into an isolated DSH profile via
#   three channels (file:// / GitHub / npm), then runs CLI checks to confirm it loads correctly.
#
# Usage:
#   bash scripts/release-smoke-install.sh \
#     --gh-user YOUR_GITHUB_USERNAME \
#     [--npm-name dsh-plugin-cli-hub] \
#     [--version 0.1.0] \
#     [--profile cli-hub-release-test]
#
# Prerequisites (run manually first):
#   1. `dsh --version` works (>= 0.1.0-rc.8)
#   2. local Node/pnpm work; `pnpm build` in this repo has already passed
#   3. channel A (file) can run at any time; B/C require push/publish first
# ============================================================
set -euo pipefail

GH_USER=""
NPM_NAME="dsh-plugin-cli-hub"
VERSION="0.1.0"
PROFILE="cli-hub-release-test"
CHANNELS="A"   # only A (file) by default. Run B/C after pushing: --channels ABC

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
  # always pass --profile, and give the DSH node subprocess a full PATH to avoid launchd PATH truncation
  # (DSH sometimes clears PATH in subprocesses; inject the common bin dirs explicitly via env.)
  PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
    dsh --profile "$PROFILE" "$@"
}

# The DSH `plugin add` subcommand requires --profile between "plugin" and "add":
#   dsh plugin --profile <name> add <spec>
# whereas ordinary subcommands (cli-hub list etc.) use `dsh --profile <name> <subcommand>`.
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

# Base URL of the DSH web profile HTTP API (dsh --profile web --no-open defaults to port 3080).
# HTTP API checks are used instead of `dsh --profile X cli-hub list`, because after startup the
# dsh-base profile becomes a resident service (web/agent loop) that does not exit for CLI subcommands.
WEB_API="http://127.0.0.1:3080/cli-hub/api"

assert_plugin_loaded() {
  section "Assert plugin loaded (via HTTP API on web profile)"
  # 1. /scan returns non-empty
  local scan_count
  scan_count="$(curl -sf "$WEB_API/scan" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$scan_count" -gt 0 ]]; then
    pass "/scan returned $scan_count items"
  else
    fail "/scan returned empty or the request failed (curl $WEB_API/scan)"
  fi

  # 2. /adapters returns 20+
  local adapter_count
  adapter_count="$(curl -sf "$WEB_API/adapters" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$adapter_count" -ge 20 ]]; then
    pass "/adapters returned $adapter_count adapters"
  else
    fail "/adapters returned $adapter_count (< 20)"
  fi

  # 3. /tools non-empty
  local tool_count
  tool_count="$(curl -sf "$WEB_API/tools" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  if [[ "$tool_count" -ge 1 ]]; then
    pass "/tools returned $tool_count tools"
  else
    fail "/tools returned empty"
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

  # adapter toggle test
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
  section "Channel A: file:// (local install channel)"
  clean_profile
  echo "dsh plugin --profile $PROFILE add file://$REPO_ROOT"
  if run_dsh_plugin_add "file://$REPO_ROOT"; then
    pass "add file:// succeeded"
  else
    fail "add file:// failed"
  fi
  assert_plugin_loaded
  assert_scan_ok
fi

# ======================== Channel B: GitHub ========================
if [[ "$CHANNELS" == *B* ]]; then
  if [[ -z "$GH_USER" ]]; then
    fail "Channel B requires --gh-user"
  else
    section "Channel B: GitHub (github:$GH_USER/dsh-plugin-cli-hub@v$VERSION)"
    clean_profile
    SPEC="github:$GH_USER/dsh-plugin-cli-hub#v$VERSION"
    if run_dsh_plugin_add "$SPEC"; then
      pass "GitHub install succeeded ($SPEC)"
    else
      fail "GitHub install failed ($SPEC)"
    fi
    assert_plugin_loaded
  fi
fi

# ======================== Channel C: npm ========================
if [[ "$CHANNELS" == *C* ]]; then
  section "Channel C: npm (npm:$NPM_NAME@$VERSION)"
  clean_profile
  if run_dsh_plugin_add "npm:$NPM_NAME@$VERSION"; then
    pass "npm install succeeded (npm:$NPM_NAME@$VERSION)"
  else
    fail "npm install failed"
  fi
  assert_plugin_loaded
fi

# ======================== Summary ========================
echo
echo "============================================================"
echo " Result: PASS=$PASS  FAIL=$FAIL"
echo "============================================================"
if [[ $FAIL -gt 0 ]]; then
  echo ">> Some checks failed; see the ❌ markers above. Temp files:"
  echo "   /tmp/dsh-clihub-list.log"
  echo "   /tmp/dsh-clihub-scan.log"
  exit 1
fi
echo ">> All passed ✅"
exit 0
