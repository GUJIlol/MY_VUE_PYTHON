#!/data/data/com.termux/files/usr/bin/bash
set -e

# ========== 0. 定位脚本所在目录 ==========
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$SCRIPT_DIR/projects"
mkdir -p "$PROJECTS_DIR"

# ========== 环境检测 ==========
echo "==> 环境检测"

if [ -z "$TERMUX_VERSION" ] && [ ! -d "/data/data/com.termux" ]; then
    echo "⚠️  未检测到 Termux 环境，脚本可能无法正常运行"
fi

MISSING=0
for cmd in python pip node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ 缺少命令: $cmd"
        MISSING=1
    fi
done
if [ $MISSING -eq 1 ]; then
    echo ""
    echo "修复方法："
    echo "  pkg install python"
    echo "  pkg install nodejs"
    exit 1
fi

PY_VER=$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=${PY_VER%.*}
PY_MINOR=${PY_VER#*.}
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 8 ]; }; then
    echo "❌ Python 版本过低: $PY_VER（需要 >= 3.8）"
    echo "   修复: pkg install python"
    exit 1
fi

NODE_VER=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
    echo "❌ Node 版本过低: v$NODE_VER（需要 >= 20.19）"
    echo "   修复: pkg upgrade nodejs"
    exit 1
fi

AVAIL_MB=$(df -k "$SCRIPT_DIR" 2>/dev/null | tail -1 | awk '{print int($4/1024)}')
if [ -n "$AVAIL_MB" ] && [ "$AVAIL_MB" -lt 500 ]; then
    echo "⚠️  磁盘可用空间不足 500MB（当前 ${AVAIL_MB}MB），可能安装失败"
fi

echo "  ✓ Python $PY_VER"
echo "  ✓ Node v$NODE_VER"
[ -n "$AVAIL_MB" ] && echo "  ✓ 磁盘可用 ${AVAIL_MB}MB"
echo ""

# ========== 输入项目名 ==========
echo "请输入项目名（英文，如 my-app）:"
read NAME

if [ -z "$NAME" ]; then
    echo "❌ 项目名不能为空"
    exit 1
fi

ROOT="$PROJECTS_DIR/$NAME"

if [ -d "$ROOT" ]; then
    echo "❌ 目录已存在: $ROOT"
    exit 1
fi

if (echo > /dev/tcp/127.0.0.1/8000) 2>/dev/null; then
    echo "⚠️  端口 8000 已被占用，请先停掉之前启动的后端"
    exit 1
fi

echo ""
echo "==> 创建目录: $ROOT"
mkdir -p "$ROOT/backend" "$ROOT/frontend"

# ========== 1. 后端 ==========
echo ""
echo "==> [1/3] 后端：创建虚拟环境"
cd "$ROOT/backend"
python -m venv venv
source venv/bin/activate

echo "==> 安装后端依赖（fastapi + uvicorn）"
pip install fastapi uvicorn -i https://mirrors.aliyun.com/pypi/simple/

echo "==> 写入测试 main.py"
cat > main.py << 'PYEOF'
"""测试后端：/api/ping 返回 pong"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/ping")
def ping():
    return {"message": "pong from Python!"}
PYEOF

# ========== 2. 前端 ==========
echo ""
echo "==> [2/3] 前端：Vue 脚手架"
echo "    提示：Package name 输入小写英文（如 $NAME）"
echo "    其余选项建议全选 No（保持纯 JS 项目）"
echo ""
cd "$ROOT/frontend"
npm create vue@latest .

if [ ! -f "$ROOT/frontend/package.json" ]; then
    echo "❌ 前端项目未创建成功"
    exit 1
fi

if [ ! -d "$ROOT/frontend/src" ]; then
    echo "❌ 前端 src 目录不存在"
    exit 1
fi

echo ""
echo "==> 安装前端依赖（约 30~60 秒）"
npm install

echo "==> 写入测试 App.vue"
cat > "$ROOT/frontend/src/App.vue" << 'VUEEOF'
<template>
  <div style="padding: 40px; font-family: system-ui, sans-serif;">
    <h1>Vue + Python 测试</h1>
    <button @click="test" style="font-size: 16px; padding: 10px 20px;">
      测试连接后端
    </button>
    <p v-if="msg" style="margin-top: 20px; font-size: 16px;">{{ msg }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const msg = ref('')
async function test() {
  try {
    const r = await fetch('http://127.0.0.1:8000/api/ping')
    const d = await r.json()
    msg.value = '✅ 后端回复：' + d.message
  } catch (e) {
    msg.value = '❌ 连接失败：' + e.message
  }
}
</script>
VUEEOF

# ========== 3. 启动服务 ==========
echo ""
echo "==> [3/3] 启动服务"

cd "$ROOT/backend"
source venv/bin/activate
nohup uvicorn main:app --reload --port 8000 > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!

cd "$ROOT/frontend"
nohup npm run dev > "$ROOT/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo "==> 等待服务启动..."
sleep 5

if ! grep -q "Uvicorn running" "$ROOT/backend.log" 2>/dev/null; then
    echo "❌ 后端启动失败，查看日志：$ROOT/backend.log"
    exit 1
fi

FRONTEND_URL=$(grep -oE 'http://localhost:[0-9]+' "$ROOT/frontend.log" | head -1)
if [ -z "$FRONTEND_URL" ]; then
    echo "⚠️  未能从日志读取前端地址，请手动查看：$ROOT/frontend.log"
    FRONTEND_URL="（未知，见日志）"
fi

echo ""
echo "════════════════════════════════════"
echo "✅ 项目创建成功"
echo "════════════════════════════════════"
echo ""
echo "📁 目录: $ROOT"
echo "🌐 前端: $FRONTEND_URL"
echo "🔧 后端: http://127.0.0.1:8000"
echo "📖 接口文档: http://127.0.0.1:8000/docs"
echo ""
echo "📄 日志:"
echo "   后端: $ROOT/backend.log"
echo "   前端: $ROOT/frontend.log"
echo ""
echo "🛑 停止服务:"
echo "   kill $BACKEND_PID $FRONTEND_PID"
echo "   或: pkill -f 'uvicorn main:app'; pkill -f vite"
echo ""