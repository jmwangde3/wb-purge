#!/usr/bin/env bash
# dsh-purge (WorkBuddy port) — 钩子运行时解析器。
# 用法: run.sh <script.mjs> [args...]
#
# 为什么要有这一层：hooks.json 里写死 node 绝对路径，会在 node 升级/搬家后**静默全废**
# （实测：node-v22.14.0-win-x64 → tools/node 之后，五个钩子一个都不再执行，表现为
#  「装了但本地不执行 / 不再自动放行」，而宿主不报任何错）。所以 hooks.json 只调用本
#  脚本，真正的 node 在这里按顺序现场解析。
#
# 解析顺序: $DSH_PURGE_NODE / $CODEBUDDY_NODE_BIN → hooks/node-path.txt（安装时写）
#           → PATH 里的 node → cmd where node → 常见安装位置 → WorkBuddy.exe（Electron 当 node）
# 全都找不到时写一行 hook-launch.log 并 exit 0（fail-open，绝不阻断宿主）。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${1:-}"
[ -n "$SCRIPT" ] || exit 0
shift || true
TARGET="$ROOT/hooks/$SCRIPT"
[ -f "$TARGET" ] || exit 0

STATE_DIR="${WORKBUDDY_CONFIG_DIR:-${CODEBUDDY_CONFIG_DIR:-$HOME/.workbuddy}}/dsh-purge"

# 1) 显式指定
for CAND in "${DSH_PURGE_NODE:-}" "${CODEBUDDY_NODE_BIN:-}"; do
  [ -n "$CAND" ] || continue
  if [ -x "$CAND" ]; then exec "$CAND" "$TARGET" "$@"; fi
done

# 2) 安装时记录的路径
HINT="$ROOT/hooks/node-path.txt"
if [ -f "$HINT" ]; then
  CAND="$(head -1 "$HINT" | tr -d '\r')"
  if [ -n "$CAND" ] && [ -x "$CAND" ]; then exec "$CAND" "$TARGET" "$@"; fi
fi

# 3) PATH
if command -v node >/dev/null 2>&1; then exec node "$TARGET" "$@"; fi

# 4) cmd 的 PATH（bash 的 PATH 常常不含 node，但 cmd 里有）
if command -v cmd >/dev/null 2>&1; then
  CAND="$(cmd //c "where node" 2>/dev/null | head -1 | tr -d '\r')"
  if [ -n "$CAND" ] && [ -f "$CAND" ]; then exec "$CAND" "$TARGET" "$@"; fi
fi

# 5) 常见安装位置（含版本化目录）
for CAND in \
  "$HOME/tools/node/node.exe" \
  "$HOME/tools"/node-v*/node.exe \
  "/c/Program Files/nodejs/node.exe" \
  "/c/Program Files (x86)/nodejs/node.exe" \
  "${LOCALAPPDATA:-}/Programs/nodejs/node.exe" \
  "${NVM_SYMLINK:-}/node.exe" \
  /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node
do
  if [ -n "$CAND" ] && [ -x "$CAND" ]; then exec "$CAND" "$TARGET" "$@"; fi
done

# 6) Electron 当 node 用（WorkBuddy 桌面版自带）
for CAND in \
  "${DSH_PURGE_APP_DIR:-}/WorkBuddy.exe" \
  "/h/Program Files/WorkBuddy/WorkBuddy.exe" \
  "/d/001installation_package/WorkBuddy/WorkBuddy.exe" \
  "/d/installation package/WorkBuddy/WorkBuddy.exe" \
  "/c/Program Files/WorkBuddy/WorkBuddy.exe" \
  "${ProgramFiles:-}/WorkBuddy/WorkBuddy.exe" \
  "${LOCALAPPDATA:-}/Programs/WorkBuddy/WorkBuddy.exe" \
  "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy"
do
  if [ -n "$CAND" ] && [ -x "$CAND" ]; then
    export ELECTRON_RUN_AS_NODE=1
    exec "$CAND" "$TARGET" "$@"
  fi
done

# 7) 失败留痕（钩子本身不能报错，否则会阻断宿主）
mkdir -p "$STATE_DIR" 2>/dev/null || true
printf '%s run.sh: no node runtime found for %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT" >>"$STATE_DIR/hook-launch.log" 2>/dev/null || true
exit 0
