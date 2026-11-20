#!/data/data/com.termux/files/usr/bin/bash
set -e

BASE=$(cd "$(dirname "$0")" && pwd)
PROJECTS_DIR="$BASE/projects"
mkdir -p "$PROJECTS_DIR"

# ========== 找压缩包 ==========
if [ -n "$1" ]; then
    ARCHIVE="$1"
    [ -f "$ARCHIVE" ] || { echo "❌ 文件不存在: $ARCHIVE"; exit 1; }
else
    # 默认在 exports/ 找最新的
    ARCHIVE=$(ls -t "$BASE"/exports/*.tar.gz 2>/dev/null | head -1)
    if [ -z "$ARCHIVE" ]; then
        echo "用法: $0 <项目压缩包.tar.gz>"
        echo "   或在 exports/ 下放压缩包后直接运行"
        exit 1
    fi
    echo "==> 自动选择最新压缩包: $ARCHIVE"
fi

# ========== 解压 ==========
echo "==> 解压到 $PROJECTS_DIR"
cd "$PROJECTS_DIR"
tar xzf "$ARCHIVE"

# 找解压出来的项目目录（压缩包内第一层目录）
NAME=$(tar tzf "$ARCHIVE" | head -1 | cut -d/ -f1)
ROOT="$PROJECTS_DIR/$NAME"

if [ ! -d "$ROOT" ]; then
    echo "❌ 解压后未找到项目目录: $ROOT"
    exit 1
fi

if [ -d "$ROOT/backend/venv" ] || [ -d "$ROOT/frontend/node_modules" ]; then
    echo "⚠️  检测到 venv 或 node_modules 已存在，跳过重装"
    echo "   如果需要重建，先手动删除它们"
    exit 0
fi

# ========== 后端 ==========
BE="$ROOT/backend"
if [ -d "$BE" ]; then
    echo ""
    echo "==> 重建后端虚拟环境"
    cd "$BE"
    python -m venv venv
    source venv/bin/activate

    if [ -f requirements.txt ]; then
        echo "==> 从 requirements.txt 安装依赖"
        pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
    else
        echo "⚠️  未找到 requirements.txt，安装基础依赖"
        pip install fastapi uvicorn -i https://mirrors.aliyun.com/pypi/simple/
    fi
    deactivate
fi

# ========== 前端 ==========
if [ -d "$ROOT/frontend" ]; then
    if [ -f "$ROOT/frontend/package.json" ]; then
        FE="$ROOT/frontend"
    elif [ -f "$ROOT/frontend/vue-project/package.json" ]; then
        FE="$ROOT/frontend/vue-project"
    else
        FE=""
    fi

    if [ -n "$FE" ]; then
        echo ""
        echo "==> 重建前端依赖"
        cd "$FE"
        npm install
        # 修权限（某些解压/复制方式会丢可执行位）
        chmod +x node_modules/.bin/* 2>/dev/null || true
    fi
fi

echo ""
echo "════════════════════════════════════"
echo "✅ 导入完成: $NAME"
echo "════════════════════════════════════"
echo ""
echo "启动项目:"
echo "   ./start.sh $NAME"
echo ""