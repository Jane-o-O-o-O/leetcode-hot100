#!/bin/bash
# macOS Finder 入口：实际启动逻辑统一放在 start.sh，避免两个脚本长期漂移。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)" || exit 1

/bin/bash "$SCRIPT_DIR/start.sh"
STATUS=$?

# Finder 双击启动时保留真正的错误信息；用户按 Ctrl+C 正常停止则直接退出。
if [ "$STATUS" -ne 0 ] && [ "$STATUS" -ne 130 ]; then
  read -r -p "按回车关闭窗口..."
fi
exit "$STATUS"
