#!/data/data/com.termux/files/usr/bin/bash
set -e

BASE=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$BASE/projects"
mkdir -p "$PROJECTS_DIR"

# ========== 扫描项目 ==========
PROJECTS=()
declare -A FRONTEND_DIR
declare -A BACKEND_DIR

for dir in "$PROJECTS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "_panel" ] && continue          # 排除面板目录
    [ -f "$dir/backend/main.py" ] || continue

    if [ -f "$dir/frontend/package.json" ]; then
        PROJECTS+=("$name")
        BACKEND_DIR[$name]="$dir/backend"
        FRONTEND_DIR[$name]="$dir/frontend"
    elif [ -f "$dir/frontend/vue-project/package.json" ]; then
        PROJECTS+=("$name")
        BACKEND_DIR[$name]="$dir/backend"
        FRONTEND_DIR[$name]="$dir/frontend/vue-project"
    fi
done

if [ ${#PROJECTS[@]} -eq 0 ]; then
    echo "❌ 未找到任何有效项目"
    echo "   需要同时存在 backend/main.py 和 frontend(/vue-project)/package.json"
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
    echo "请选择项目："
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
BE="$ROOT/backend"
FE="${FRONTEND_DIR[$NAME]}"
BE_PID_FILE="$ROOT/.backend.pid"
FE_PID_FILE="$ROOT/.frontend.pid"

echo ""
echo "==> 启动项目: $NAME"

# ========== 已在运行？ ==========
if [ -f "$BE_PID_FILE" ] && kill -0 "$(cat "$BE_PID_FILE")" 2>/dev/null; then
    echo "⚠️  这个项目已经在运行"
    echo "   后端 PID: $(cat "$BE_PID_FILE")"
    [ -f "$FE_PID_FILE" ] && echo "   前端 PID: $(cat "$FE_PID_FILE")"
    echo -n "   是否重启？(y/N): "
    read ANS
    if [ "$ANS" != "y" ] && [ "$ANS" != "Y" ]; then
        if [ -f "$ROOT/frontend.log" ]; then
            URL=$(grep -oE 'http://localhost:[0-9]+' "$ROOT/frontend.log" | head -1)
            [ -n "$URL" ] && echo "🌐 前端: $URL"
        fi
        echo "🔧 后端: http://127.0.0.1:8000"
        exit 0
    fi
    kill "$(cat "$BE_PID_FILE")" 2>/dev/null || true
    [ -f "$FE_PID_FILE" ] && kill "$(cat "$FE_PID_FILE")" 2>/dev/null || true
    sleep 2
fi

# ========== 端口检查 ==========
if (echo > /dev/tcp/127.0.0.1/8000) 2>/dev/null; then
    echo "⚠️  端口 8000 已被占用（可能是另一个项目在跑）"
    echo -n "   停止它并启动当前项目？(y/N): "
    read ANS
    if [ "$ANS" != "y" ] && [ "$ANS" != "Y" ]; then
        echo "已取消"
        exit 1
    fi
    pkill -f 'uvicorn main:app' 2>/dev/null || true
    pkill -f vite 2>/dev/null || true
    sleep 2
fi

# ========== 启动后端 ==========
cd "$BE"
source venv/bin/activate
nohup uvicorn main:app --reload --port 8000 > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BE_PID_FILE"

# ========== 启动前端 ==========
cd "$FE"
nohup npm run dev > "$ROOT/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FE_PID_FILE"

echo "==> 等待服务启动..."
sleep 5

if ! grep -q "Uvicorn running" "$ROOT/backend.log" 2>/dev/null; then
    echo "❌ 后端启动失败"
    echo "   查看: tail -20 $ROOT/backend.log"
    exit 1
fi

FRONTEND_URL=$(grep -oE 'http://localhost:[0-9]+' "$ROOT/frontend.log" | head -1)
[ -z "$FRONTEND_URL" ] && FRONTEND_URL="（未知，见 $ROOT/frontend.log）"

echo ""
echo "════════════════════════════════════"
echo "✅ 启动成功: $NAME"
echo "════════════════════════════════════"
echo ""
echo "🌐 前端: $FRONTEND_URL"
echo "🔧 后端: http://127.0.0.1:8000"
echo "📖 文档: http://127.0.0.1:8000/docs"
echo ""
echo "📄 日志:"
echo "   $ROOT/backend.log"
echo "   $ROOT/frontend.log"
echo ""
echo "🛑 停止本项目的服务:"
echo "   kill \$(cat $BE_PID_FILE) \$(cat $FE_PID_FILE)"
echo ""