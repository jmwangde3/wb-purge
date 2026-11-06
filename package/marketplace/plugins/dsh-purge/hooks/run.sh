#!/usr/bin/env bash
# dsh-purge (WorkBuddy port) — 钩子运行时解析器。
# 用法: run.sh <script.mjs> [args...]
# 解析顺序: CODEBUDDY_NODE_BIN -> node -> WorkBuddy.exe (ELECTRON_RUN_AS_NODE=1)
# 找不到运行时就静默 exit 0（fail-open：钩子不生效，绝不阻断宿主）。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${1:-}"
[ -n "$SCRIPT" ] || exit 0
shift || true
TARGET="$ROOT/hooks/$SCRIPT"
[ -f "$TARGET" ] || exit 0

NODE_BIN="${CODEBUDDY_NODE_BIN:-}"
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$TARGET" "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$TARGET" "$@"
fi

# Electron 当 node 用
for CAND in \
  "/d/001installation_package/WorkBuddy/WorkBuddy.exe" \
  "/d/installation package/WorkBuddy/WorkBuddy.exe" \
  "/c/Program Files/WorkBuddy/WorkBuddy.exe" \
  "${LOCALAPPDATA:-}/Programs/WorkBuddy/WorkBuddy.exe"
do
  if [ -x "$CAND" ]; then
    export ELECTRON_RUN_AS_NODE=1
    exec "$CAND" "$TARGET" "$@"
  fi
done

exit 0
