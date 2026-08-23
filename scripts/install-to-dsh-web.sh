#!/usr/bin/env bash
# ========================================================================
# dsh-plugin-cli-hub/install-to-dsh-web.sh
# ------------------------------------------------------------------------
# Installs the local dev copy of dsh-plugin-cli-hub into the DSH web profile (~/.dsh/profiles/web)
#
# Why this must be run manually:
#   The TRAE sandbox gets EPERM on ~/.dsh/profiles/* (only the user's own shell may write there),
#   so this repo cannot run it for you. Just copy and run this one line:
#
#      bash /path/to/dsh-cli/scripts/install-to-dsh-web.sh
#
# Verify after install:
#   grep cli-hub /tmp/dsh-web.log
#   -> you should see [cli-hub] loaded. adapter count= or failed.
# ========================================================================
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
PLUGIN_LOCAL="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_PKG_NAME="dsh-plugin-cli-hub"

log()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m==> %s\033[0m\n" "$*" >&2; }
die()  { printf "\033[1;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

[ -d "$PROFILE_DIR" ] || die "DSH web profile directory missing: $PROFILE_DIR (run dsh web once to initialize it first)"

# 1. build the plugin
log "Building local plugin ($PLUGIN_LOCAL)"
(cd "$PLUGIN_LOCAL" && pnpm build)

# 2. stop DSH
log "Stopping any running dsh web process"
pkill -f "dsh web" 2>/dev/null || true
pkill -f "node.*\.bin/dsh" 2>/dev/null || true
sleep 2
pgrep -af "dsh web" >/dev/null && warn "some dsh web processes survived; kill them manually before restarting"

# 3. pnpm add the local path
log "pnpm-adding the local plugin into the web profile"
cd "$PROFILE_DIR"
pnpm add "file://$PLUGIN_LOCAL" --prefer-offline

# 4. register into bundles (if not registered yet)
log "Ensuring dsh.profile.bundles contains $PLUGIN_PKG_NAME"
python3 - "$PROFILE_DIR/package.json" "$PLUGIN_PKG_NAME" <<PY
import json, sys
p, pkg_name = sys.argv[1], sys.argv[2]
with open(p) as f: pkg = json.load(f)
dsh = pkg.setdefault('dsh', {})
profile = dsh.setdefault('profile', {})
bundles = profile.setdefault('bundles', [])
added = False
if pkg_name not in bundles:
    bundles.append(pkg_name)
    added = True
with open(p, 'w') as f: json.dump(pkg, f, indent=2, ensure_ascii=False); f.write('\n')
print('OK', 'added' if added else 'already present', 'bundle count:', len(bundles))
PY

# 5. start DSH
LOG=/tmp/dsh-web.log
log "Restarting dsh web. Follow logs with tail -f $LOG"
# clear old logs first
: > "$LOG"
cd "$PROFILE_DIR"   # running from the profile dir lets npx resolve node_modules correctly
nohup npx dsh web > "$LOG" 2>&1 &
DSH_PID=$!
echo "DSH PID = $DSH_PID"
sleep 6

# 6. result output
echo
log "Install complete. Diagnostic commands:"
echo "  # 1. plugin load log"
echo "  grep -E 'cli-hub|CLI Hub|ERROR.*cli' $LOG | head -20"
echo
echo "  # 2. open DSH in a browser -> Settings -> Plugin list"
echo "  open http://127.0.0.1:3080/"
echo
echo "  # 3. list discovered CLIs + quota"
echo "  Say in the DSH chat: \"Scan the AI CLIs installed on this machine and their subscription quota\""
echo
echo "  # Uninstall the plugin"
echo "  (cd $PROFILE_DIR && pnpm remove $PLUGIN_PKG_NAME)"
echo "  then remove the package name from the package.json dsh.profile.bundles array"
