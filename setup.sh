#!/usr/bin/env bash
# 一键配置环境：克隆下来跑这一个脚本就能用
# 用法: bash setup.sh        （Termux / Linux 都可以）
#       bash setup.sh --check  # 只检查不安装

set -u

ROOT=$(cd "$(dirname "$0")" && pwd)
PANEL="$ROOT/_panel"
SERVER="$PANEL/server"
MIRROR="https://registry.npmmirror.com"
CHECK_ONLY=0
REBUILD=0
MIGRATE=0
case "${1:-}" in
    --check)   CHECK_ONLY=1 ;;
    --rebuild) REBUILD=1 ;;
    --migrate) MIGRATE=1 ;;
esac

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
ok()   { printf '  %s✓%s %s\n' "$C_OK" "$C_OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_OFF" "$1"; }
die()  { printf '%s✗ %s%s\n' "$C_ERR" "$1" "$C_OFF"; exit 1; }

IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || printf '%s' "${PREFIX:-}" | grep -q 'com.termux'; then
    IS_TERMUX=1
fi

printf '\n==> 配置 my-vue-pythongame（%s）\n\n' "$([ $IS_TERMUX = 1 ] && echo Termux || echo Linux)"

# ---------- 1. Node ----------
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v 2>/dev/null)
    ok "node $NODE_VER"
    if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -lt 18 ] 2>/dev/null; then
        warn "node 版本偏低（需要 >= 18），面板可能起不来"
    fi
else
    if [ $IS_TERMUX = 1 ] && [ $CHECK_ONLY = 0 ]; then
        echo "==> 安装 nodejs"
        pkg install -y nodejs-lts 2>/dev/null || pkg install -y nodejs || die "nodejs 安装失败"
        ok "node $(node -v)"
    else
        die "缺少 node（Termux: pkg install nodejs；其它系统: 装 Node 18+）"
    fi
fi

if command -v npm >/dev/null 2>&1; then
    ok "npm $(npm -v)"
else
    die "缺少 npm（Termux 里它跟 nodejs 一起装）"
fi

# ---------- 2. Python ----------
if command -v python >/dev/null 2>&1; then
    ok "python $(python -V 2>&1 | awk '{print $2}')  ($(command -v python))"
elif command -v python3 >/dev/null 2>&1; then
    ok "python3 $(python3 -V 2>&1 | awk '{print $2}')  (面板会自动找 python3)"
else
    if [ $IS_TERMUX = 1 ] && [ $CHECK_ONLY = 0 ]; then
        echo "==> 安装 python"
        pkg install -y python || die "python 安装失败"
        ok "python $(python -V 2>&1 | awk '{print $2}')"
    else
        die "缺少 python（Termux: pkg install python）"
    fi
fi

# ---------- 3. 目录 ----------
mkdir -p "$ROOT/exports" "$ROOT/projects" "$PANEL/logs"
[ -f "$PANEL/logs/.gitkeep" ] || touch "$PANEL/logs/.gitkeep"
ok "目录 projects/ 、exports/ 、_panel/logs/ 就绪"

# ---------- 4. 面板依赖 ----------
NEED_INSTALL=0
if [ ! -d "$SERVER/node_modules" ] || [ ! -d "$SERVER/node_modules/tsx" ]; then
    NEED_INSTALL=1
fi

if [ $NEED_INSTALL = 1 ]; then
    if [ $CHECK_ONLY = 1 ]; then
        warn "面板依赖未安装（去掉 --check 再跑一次即可自动装）"
    else
        echo "==> 安装面板依赖（express / tsx / typescript …）"
        cd "$SERVER" || die "进不去 $SERVER"
        if ! npm install --no-audit --no-fund --registry="$MIRROR"; then
            warn "镜像源失败，改用默认源重试"
            npm install --no-audit --no-fund || die "npm install 失败（检查网络）"
        fi
        ok "面板依赖已装好"
    fi
else
    ok "面板依赖已存在，跳过"
fi

# ---------- 5. 迁移旧布局（项目从根目录挪进 projects/） ----------
if [ $MIGRATE = 1 ] && [ $CHECK_ONLY = 0 ]; then
    echo "==> 迁移旧布局"
    moved=0
    for dir in "$ROOT"/*/; do
        name=$(basename "$dir")
        case "$name" in
            _panel|exports|projects|node_modules) continue ;;
        esac
        if [ -f "$dir/backend/main.py" ] || [ -f "$dir/frontend/package.json" ]; then
            if [ -d "$ROOT/projects/$name" ]; then
                warn "$name 在 projects/ 里已存在，跳过（请手动合并）"
            else
                mv "$dir" "$ROOT/projects/$name" && ok "$name → projects/$name" && moved=$((moved+1))
            fi
        fi
    done
    [ $moved = 0 ] && ok "没有需要迁移的项目"
fi

# ---------- 6. 补建已有项目的环境 ----------
if [ $REBUILD = 1 ] && [ $CHECK_ONLY = 0 ]; then
    echo "==> 补建已有项目的 venv / node_modules"
    PY_BIN=$(command -v python || command -v python3)
    for dir in "$ROOT/projects"/*/; do
        name=$(basename "$dir")
        [ -f "$dir/backend/main.py" ] || continue

        if [ ! -x "$dir/backend/venv/bin/python" ]; then
            echo "  · $name backend: 建 venv + 装依赖（可能要几分钟）"
            "$PY_BIN" -m venv "$dir/backend/venv" || { warn "$name venv 创建失败，跳过"; continue; }
            "$dir/backend/venv/bin/python" -m pip install -q --disable-pip-version-check \
                -i https://mirrors.aliyun.com/pypi/simple/ \
                -r "$dir/backend/requirements.txt" || warn "$name 后端依赖安装失败"
        else
            ok "$name backend 环境已存在"
        fi

        for FE in "$dir/frontend" "$dir/vue-project"; do
            [ -f "$FE/package.json" ] || continue
            if [ ! -d "$FE/node_modules" ]; then
                echo "  · $name $(basename "$FE"): npm install"
                ( cd "$FE" && npm install --no-audit --no-fund --registry="$MIRROR" \
                    || npm install --no-audit --no-fund ) || warn "$name 前端依赖安装失败"
            else
                ok "$name $(basename "$FE") 依赖已存在"
            fi
        done
    done
fi

# ---------- 7. 权限 ----------
chmod +x "$ROOT"/*.sh "$PANEL/run.sh" 2>/dev/null || true
ok "脚本可执行权限已设置"

# ---------- 8. 常驻建议 ----------
if [ $IS_TERMUX = 1 ]; then
    warn "Termux 建议先 termux-wake-lock，并把电池优化设为「无限制」，否则面板容易被系统杀"
fi

printf '\n完成。启动面板：\n'
printf '    cd %s\n' "$PANEL"
printf '    ./run.sh\n\n'
printf '首次启动会打印一键登录地址（带 token），直接用浏览器打开即可。\n\n'
