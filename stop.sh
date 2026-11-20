#!/data/data/com.termux/files/usr/bin/bash

BASE=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$BASE/projects"
mkdir -p "$PROJECTS_DIR"
TARGET="$1"
STOPPED=0
FOUND=0

# ========== 遍历所有项目 ==========
for dir in "$PROJECTS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "_panel" ] && continue          # 排除面板目录
    [ "$name" = "exports" ] && continue

    # 指定了项目名时，跳过其他
    if [ -n "$TARGET" ] && [ "$name" != "$TARGET" ]; then
        continue
    fi

    FOUND=1

    for role in backend frontend; do
        PID_FILE="$dir/.$role.pid"
        [ -f "$PID_FILE" ] || continue

        PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -z "$PID" ]; then
            rm -f "$PID_FILE"
            continue
        fi

        if kill -0 "$PID" 2>/dev/null; then
            echo "==> 停止 $name / $role (PID $PID)"
            kill "$PID" 2>/dev/null || true

            # 最多等 2.5 秒让进程正常退出
            for _ in 1 2 3 4 5; do
                kill -0 "$PID" 2>/dev/null || break
                sleep 0.5
            done

            # 还没退就强杀
            if kill -0 "$PID" 2>/dev/null; then
                echo "    未退出，强制停止"
                kill -9 "$PID" 2>/dev/null || true
            fi
            STOPPED=$((STOPPED+1))
        else
            echo "==> $name / $role 已退出（清理 PID 文件）"
        fi

        rm -f "$PID_FILE"
    done
done

# ========== 指定项目但没找到 ==========
if [ -n "$TARGET" ] && [ $FOUND -eq 0 ]; then
    echo "❌ 项目不存在: $TARGET"
    exit 1
fi

# ========== 残留检查（uvicorn --reload 的 worker 有时会残留） ==========
if (echo > /dev/tcp/127.0.0.1/8000) 2>/dev/null; then
    echo ""
    echo "⚠️  端口 8000 仍被占用，可能有残留进程"
    echo "   查看: pkill -f 'uvicorn main:app'"
fi

echo ""
if [ $STOPPED -eq 0 ]; then
    echo "没有正在运行的服务"
else
    echo "✅ 已停止 $STOPPED 个服务"
fi