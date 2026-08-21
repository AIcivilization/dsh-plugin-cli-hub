#!/usr/bin/env bash
# ========================================================================
# dsh-plugin-cli-hub/install-to-dsh-web.sh
# ------------------------------------------------------------------------
# 把本机开发路径下的 dsh-plugin-cli-hub 安装到 DSH web profile（~/.dsh/profiles/web）
#
# 为什么需要手动执行：
#   TRAE 沙箱对 ~/.dsh/profiles/* 目录是 EPERM（只允许用户自己的 shell 写），
#   所以插件项目无法自动帮你跑。复制这一行命令执行即可：
#
#      bash /Users/wf/自进化/临时/dsh-cli/scripts/install-to-dsh-web.sh
#
# 安装后验证：
#   grep cli-hub /tmp/dsh-web.log
#   → 应该能看到 [cli-hub] loaded. adapter count= 或 failed.
# ========================================================================
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
PLUGIN_LOCAL="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_PKG_NAME="dsh-plugin-cli-hub"

log()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m==> %s\033[0m\n" "$*" >&2; }
die()  { printf "\033[1;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

[ -d "$PROFILE_DIR" ] || die "DSH web profile 目录不存在：$PROFILE_DIR (先跑一次 dsh web 初始化)"

# 1. 构建插件
log "构建本地插件 ($PLUGIN_LOCAL)"
(cd "$PLUGIN_LOCAL" && pnpm build)

# 2. 停止 DSH
log "停止现有 dsh web 进程（如果正在跑）"
pkill -f "dsh web" 2>/dev/null || true
pkill -f "node.*\.bin/dsh" 2>/dev/null || true
sleep 2
pgrep -af "dsh web" >/dev/null && warn "还有 dsh web 进程没杀掉，需要手动 kill 再重启"

# 3. pnpm add 本地路径
log "在 web profile 中 pnpm add 本地插件"
cd "$PROFILE_DIR"
pnpm add "file://$PLUGIN_LOCAL" --prefer-offline

# 4. 注册到 bundles（如果还未注册）
log "确保 dsh.profile.bundles 里包含 $PLUGIN_PKG_NAME"
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

# 5. 启动 DSH
LOG=/tmp/dsh-web.log
log "重新启动 dsh web。日志 tail -f $LOG"
# 先清旧日志
: > "$LOG"
cd "$PROFILE_DIR"   # pnpm exec dsh 在 profile 目录下能正确找到 node_modules 解析
nohup npx dsh web > "$LOG" 2>&1 &
DSH_PID=$!
echo "DSH PID = $DSH_PID"
sleep 6

# 6. 结果输出
echo
log "安装完成。诊断命令："
echo "  # 1. 插件加载日志"
echo "  grep -E 'cli-hub|CLI Hub|ERROR.*cli' $LOG | head -20"
echo
echo "  # 2. 浏览器打开 DSH → 设置 → 插件列表"
echo "  open http://127.0.0.1:3080/"
echo
echo "  # 3. 列出已发现的 CLI + 额度"
echo "  在 DSH 对话里说：\"扫描本机已安装的 AI CLI 和订阅额度\""
echo
echo "  # 卸载插件"
echo "  (cd $PROFILE_DIR && pnpm remove $PLUGIN_PKG_NAME)"
echo "  然后从 package.json dsh.profile.bundles 数组里去掉这个包名"
