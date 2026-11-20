#!/data/data/com.termux/files/usr/bin/bash
set -e

BASE=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$BASE/projects"
mkdir -p "$PROJECTS_DIR"
OUT_DIR="$BASE/exports"
mkdir -p "$OUT_DIR"

# ========== 扫描项目 ==========
PROJECTS=()
for dir in "$PROJECTS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "_panel" ] && continue          # 排除面板目录
    [ "$name" = "exports" ] && continue
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
    echo "请选择要打包的项目："
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

ROOT="$PROJECTS_DIR/$NAME"

# ========== 生成 requirements.txt（如果后端有 venv） ==========
BE="$ROOT/backend"
if [ -d "$BE/venv" ]; then
    echo "==> 生成 requirements.txt"
    cd "$BE"
    source venv/bin/activate
    pip freeze > requirements.txt
    deactivate
fi

# ========== 打包 ==========
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE="$OUT_DIR/${NAME}_${TIMESTAMP}.tar.gz"

echo "==> 打包中（排除 venv / node_modules / 日志 / 缓存）"

cd "$PROJECTS_DIR"
tar czf "$ARCHIVE" \
    --exclude="$NAME/backend/venv" \
    --exclude="$NAME/frontend/node_modules" \
    --exclude="$NAME/frontend/vue-project/node_modules" \
    --exclude="$NAME/frontend/node_modules/.vite" \
    --exclude="$NAME/frontend/vue-project/node_modules/.vite" \
    --exclude="$NAME/backend/__pycache__" \
    --exclude="$NAME/backend/eco_sim/__pycache__" \
    --exclude="$NAME/*.log" \
    --exclude="$NAME/.backend.pid" \
    --exclude="$NAME/.frontend.pid" \
    "$NAME"

SIZE=$(du -h "$ARCHIVE" | cut -f1)

echo ""
echo "════════════════════════════════════"
echo "✅ 打包完成"
echo "════════════════════════════════════"
echo ""
echo "📦 文件: $ARCHIVE"
echo "📏 大小: $SIZE"
echo ""
echo "迁移到新环境后，用 import.sh 恢复："
echo "   ./import.sh $ARCHIVE"
echo ""