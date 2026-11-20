#!/usr/bin/env bash

PANEL_DIR=$(cd "$(dirname "$0")" && pwd)
PID_FILE="$PANEL_DIR/server/.pid"
LOG="$PANEL_DIR/logs/panel.log"
PORT=7000
CMD="${1:-start}"

mkdir -p "$PANEL_DIR/logs"

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

print_url() {
    TOKEN=$(cat "$PANEL_DIR/server/.token" 2>/dev/null || echo "")
    echo ""
    echo "✅ 面板运行中 (PID $(cat "$PID_FILE"))"
    echo "   地址: http://127.0.0.1:$PORT"
    echo "   一键登录: http://127.0.0.1:$PORT/?token=$TOKEN"
    echo "   日志: $LOG"
}

case "$CMD" in
    stop)
        if is_running; then
            PID=$(cat "$PID_FILE")
            kill "$PID" 2>/dev/null || true
            sleep 1
            kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
        fi
        # npm 会派生子进程，兜底清理 panel 自己的 tsx 进程
        pkill -f "tsx/dist/cli.mjs" 2>/dev/null || true
        rm -f "$PID_FILE"
        echo "==> 面板已停止"
        exit 0
        ;;
    status)
        if is_running; then
            print_url
        else
            echo "面板未在运行"
        fi
        exit 0
        ;;
    url)
        if is_running; then
            TOKEN=$(cat "$PANEL_DIR/server/.token" 2>/dev/null || echo "")
            echo "http://127.0.0.1:$PORT/?token=$TOKEN"
        else
            echo "面板未在运行"
            exit 1
        fi
        exit 0
        ;;
    restart)
        "$0" stop >/dev/null 2>&1 || true
        ;;
    start|"")
        ;;
    *)
        echo "用法: $0 [start|stop|restart|status|url]"
        exit 1
        ;;
esac

if is_running; then
    echo "⚠️  panel 已在运行 (PID $(cat "$PID_FILE"))"
    print_url
    exit 0
fi

if [ ! -d "$PANEL_DIR/server/node_modules" ] || [ ! -d "$PANEL_DIR/server/node_modules/tsx" ]; then
    echo "==> 首次运行，安装面板依赖"
    cd "$PANEL_DIR/server"
    npm install --no-audit --no-fund || { echo "❌ npm install 失败"; exit 1; }
fi

# 端口被别的进程占着（PID 文件丢失的情况）
if (echo > /dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
    echo "⚠️  端口 $PORT 已被占用，可能是上一次的面板残留"
    echo "   先执行: $0 stop"
    exit 1
fi

cd "$PANEL_DIR/server"
chmod +x node_modules/.bin/* 2>/dev/null || true
nohup npm start > "$LOG" 2>&1 &
echo $! > "$PID_FILE"

echo "==> panel 启动中，pid $(cat "$PID_FILE")"
for _ in $(seq 1 20); do
    sleep 0.6
    grep -q "panel server:" "$LOG" 2>/dev/null && break
done

if ! grep -q "panel server:" "$LOG" 2>/dev/null; then
    echo "❌ 启动失败，查看: tail -20 $LOG"
    exit 1
fi

print_url
