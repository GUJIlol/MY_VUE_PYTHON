#!/data/data/com.termux/files/usr/bin/bash
set -e

BASE=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$BASE/projects"
mkdir -p "$PROJECTS_DIR"

# ========== 扫描项目 ==========
PROJECTS=()
for dir in "$PROJECTS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "_panel" ] && continue          # 排除面板目录
    # 宽松标准：只要有 backend 或 frontend 目录，就认为是项目
    if [ -d "$dir/backend" ] || [ -d "$dir/frontend" ]; then
        PROJECTS+=("$name")
    fi
done

if [ ${#PROJECTS[@]} -eq 0 ]; then
    echo "❌ 未找到任何项目"
    exit 1
fi

# ========== 选择项目 ==========
if [ -n "$1" ]; then
    NAME="$1"
    FOUND=0
    for p in "${PROJECTS[@]}"; do
        [ "$p" = "$NAME" ] && FOUND=1
    done
    if [ $FOUND -eq 0 ]; then
        echo "❌ 项目不存在: $NAME"
        echo "   可用: ${PROJECTS[*]}"
        exit 1
    fi
else
    echo "请选择要删除的项目："
    for i in "${!PROJECTS[@]}"; do
        echo "  $((i+1)). ${PROJECTS[$i]}"
    done
    echo ""
    echo -n "输入编号: "
    read IDX
    if ! [[ "$IDX" =~ ^[0-9]+$ ]] || [ "$IDX" -lt 1 ] || [ "$IDX" -gt ${#PROJECTS[@]} ]; then
        echo "❌ 无效选择"
        exit 1
    fi
    NAME="${PROJECTS[$((IDX-1))]}"
fi

# ========== 安全检查：防止路径穿越 ==========
case "$NAME" in
    */*|.|..|"")
        echo "❌ 非法项目名"
        exit 1
        ;;
esac

ROOT="$PROJECTS_DIR/$NAME"

if [ ! -d "$ROOT" ]; then
    echo "❌ 目录不存在: $ROOT"
    exit 1
fi

# 额外保险：确保 ROOT 在 BASE 下，且不是 BASE 本身
if [ "$ROOT" = "$BASE" ] || [[ "$ROOT" != "$BASE/"* ]]; then
    echo "❌ 路径校验失败: $ROOT"
    exit 1
fi

echo ""
echo "⚠️  即将删除: $ROOT"
echo "   整个目录（代码 + venv + node_modules + 日志）都会被移除"
echo ""

# ========== 检查服务是否在跑 ==========
BE_PID_FILE="$ROOT/.backend.pid"
FE_PID_FILE="$ROOT/.frontend.pid"
RUNNING=0

if [ -f "$BE_PID_FILE" ] && kill -0 "$(cat "$BE_PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "   检测到后端在运行 (PID $(cat "$BE_PID_FILE"))"
    RUNNING=1
fi
if [ -f "$FE_PID_FILE" ] && kill -0 "$(cat "$FE_PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "   检测到前端在运行 (PID $(cat "$FE_PID_FILE"))"
    RUNNING=1
fi

if [ $RUNNING -eq 1 ]; then
    echo ""
    echo -n "先停止服务再删除？(y/N): "
    read ANS
    if [ "$ANS" != "y" ] && [ "$ANS" != "Y" ]; then
        echo "已取消"
        exit 1
    fi
    [ -f "$BE_PID_FILE" ] && kill "$(cat "$BE_PID_FILE")" 2>/dev/null || true
    [ -f "$FE_PID_FILE" ] && kill "$(cat "$FE_PID_FILE")" 2>/dev/null || true
    sleep 2
fi

# ========== 二次确认：手动输入项目名 ==========
echo ""
echo -n "请输入项目名确认删除（输入 $NAME 继续）: "
read CONFIRM
if [ "$CONFIRM" != "$NAME" ]; then
    echo "❌ 名称不匹配，已取消"
    exit 1
fi

# ========== 删除 ==========
echo ""
echo "==> 删除中..."
rm -rf "$ROOT"

if [ -d "$ROOT" ]; then
    echo "❌ 删除失败，可能仍有文件被占用"
    echo "   检查: lsof +D $ROOT 2>/dev/null"
    exit 1
fi

echo ""
echo "✅ 已删除: $NAME"
echo ""