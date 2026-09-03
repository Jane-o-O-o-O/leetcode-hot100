#!/bin/bash
# macOS / Linux 启动器：优先使用带缓存与安全校验的 Node 静态服务器，
# 没有 Node 时回退 Python 3。兼容 macOS 自带的 Bash 3.2。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
cd "$SCRIPT_DIR" || exit 1

# Finder 启动的 .command 有时拿不到 Homebrew PATH；同时覆盖 Apple Silicon
# 与 Intel Mac 的默认安装位置，不需要加载用户 shell 配置文件。
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -n "$NODE_BIN" ] && ! "$NODE_BIN" --version >/dev/null 2>&1; then
  NODE_BIN=''
fi
PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
if [ -n "$PYTHON_BIN" ] && ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(sys.version_info < (3, 8))' >/dev/null 2>&1; then
  PYTHON_BIN=''
fi

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

PORT=8931
while port_in_use "$PORT"; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8951 ]; then
    echo "错误：8931-8951 端口都被占用，请关闭一些程序后重试。"
    exit 1
  fi
done
URL="http://127.0.0.1:$PORT"

PROXY_PID=''
cleanup() {
  if [ -n "$PROXY_PID" ]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# AI 助手本地代理仅在 Node 可用且端口空闲时启动，随主进程可靠清理。
if [ -n "$NODE_BIN" ] && ! port_in_use 8966; then
  "$NODE_BIN" tools/cors-proxy.mjs >/dev/null 2>&1 &
  PROXY_PID=$!
fi

if [ -n "$NODE_BIN" ]; then
  CMD=("$NODE_BIN" tools/serve.js "$PORT")
  SERVER_LABEL="Node（缓存优化）"
elif [ -n "$PYTHON_BIN" ]; then
  CMD=("$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1)
  SERVER_LABEL="Python 3（兼容模式）"
else
  echo "错误：未找到可用的 Node.js 或 Python 3.8+。"
  echo "macOS 推荐安装 Node.js：https://nodejs.org"
  exit 1
fi

echo "======================================"
echo "  LeetCode Hot 100 刷题"
echo "  地址：$URL"
echo "  服务：$SERVER_LABEL"
echo "  停止：按 Ctrl+C 或关闭本窗口"
echo "======================================"

# 等服务器真正可访问后再打开浏览器，避免较慢的 Mac 上先出现连接失败页。
open_when_ready() {
  ATTEMPT=0
  if command -v curl >/dev/null 2>&1; then
    while [ "$ATTEMPT" -lt 50 ]; do
      if curl --silent --fail --max-time 1 "$URL/" >/dev/null 2>&1; then
        break
      fi
      ATTEMPT=$((ATTEMPT + 1))
      sleep 0.1
    done
    [ "$ATTEMPT" -lt 50 ] || return 0
  else
    sleep 1
  fi

  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
}

if [ "${HOT100_NO_BROWSER:-0}" != '1' ]; then
  open_when_ready &
fi

"${CMD[@]}"
