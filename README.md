# my-vue-pythongame

Vue 3 + Python 多项目工作区（后端默认 Starlette，也可选 FastAPI），带一个网页管理器（`_panel`）。
原来要手敲 `start.sh` / `new-game.sh` / `export.sh`… 这些 shell 脚本，现在全部变成浏览器里的按钮，点一下真的会执行。

## 快速开始

```bash
git clone <repo> && cd my-vue-pythongame
bash setup.sh            # 检查 Python/Node、装面板依赖、给脚本加执行权限
_panel/run.sh            # 启动面板，会打印带 token 的地址
```

打开终端里那行 `http://127.0.0.1:7000/?token=...` 就是面板。

- 面板依赖已装过时，`setup.sh` 会跳过 `npm install`
- 六个原始脚本（`start.sh` 等）的 shebang 指向 Termux，在 Linux/macOS 上请用 `bash start.sh` 这种写法，或直接走面板
- 已有项目在别处 clone 下来后，`bash setup.sh --rebuild` 会补建 `venv` / `node_modules`
- Termux 上如果创建项目时进程被系统杀（`signal 9`），见文末「排障」

## 目录

```
.
├── start.sh / stop.sh          # 原脚本，保留可用（面板不依赖它们）
├── new-game.sh / import.sh
├── export.sh / delete.sh
├── setup.sh                    # 一键装环境
├── projects/                   # 所有业务项目放这里（整目录不进仓库，只留 .gitkeep）
├── _panel/                     # 管理器
│   ├── run.sh                  # 启停面板：start|stop|restart|status|url
│   ├── server/src/             # Express + tsx 写 TS，不编译
│   │   ├── index.ts            # 路由与鉴权
│   │   ├── runner.ts           # 启停、端口检测、进程树清理
│   │   ├── create.ts           # 新建项目流程
│   │   ├── scaffold.ts         # 前端脚手架模板与预览
│   │   ├── archive.ts          # 导出 / 导入 / 打包记录
│   │   ├── remove.ts           # 删除
│   │   └── logs.ts             # 日志 SSE
│   └── web/                    # 纯 HTML/CSS/JS，无构建
└── exports/                    # 导出的 tar.gz（不进仓库）
```

单个项目内部：

```
projects/<项目名>/
├── backend/                    # Starlette 或 FastAPI，固定 8000 端口
└── frontend/                   # Vite，端口自动分配（5173 起）
```

## 面板能干什么

| 功能 | 说明 |
|---|---|
| 项目列表 | 扫描 `*/backend/main.py` + `frontend/package.json`，显示前后端状态灯 |
| 启动 / 停止 / 重启 | 按 `/proc` 收集进程树，先 TERM 后 KILL；端口被别的项目占着会提示，可选强制接管 |
| 新建项目 | 建 `venv`、装后端依赖（Starlette 纯 Python 秒装 / FastAPI 需编译）、按勾选生成 Vue 脚手架、`npm install`、可选立即启动；一律建在 `projects/` 下 |
| 导入 / 导出 | `.tar.gz` 上传导入或从 `exports/` 恢复；导出会先 `pip freeze` |
| 删除 | 先停服务，再要求手动输入项目名 |
| 日志 | 后端 / 前端日志 SSE 实时滚动，自动去掉 ANSI 颜色码 |
| 环境 | Python / Node / npm 版本、磁盘、8000 端口占用、Termux 检测 |

新建弹窗里还有一个后端框架切换（**Starlette 纯 Python 秒装** / FastAPI 需编译 Rust）+ 5 个前端开关（TypeScript / Vue Router / Pinia / ESLint / 示例页），都只影响生成的文件，**不调用 `npm create vue@latest`**：面板没有 TTY，create-vue 的提问项还随版本漂移，直接拼模板更可控。改动勾选会实时刷新「预览生成的文件」，创建前就能看到要写什么。

Starlette 版模板同样提供 `/api/ping`，返回 `pong from Python!`；路由写法与 FastAPI 基本一致，以后想迁移直接改 `requirements.txt` 和 `main.py` 即可。

## 仓库里不放什么

`.gitignore` 已排除：`node_modules`、`backend/venv`、`.token`、`.pid`、`logs/*.log`、`exports/*.tar.gz`、`dist`、`__pycache__`、`.create-prefs.json`。
也就是说 clone 下来是干净的源码，环境靠 `setup.sh` 重建，token 首次启动自动生成。

所有项目都住在 `projects/` 里，`.gitignore` 直接把整个目录忽略掉——**新建的项目天然不会被提交**，不需要每次手动排除。老版本（项目散在根目录）升级时跑一次 `bash setup.sh --migrate` 就会把根目录的项目挪进去。

## 排障

**创建项目时 Termux 输出 `[Process completed (signal 9)]`**
Android 的 phantom process killer / 低内存把进程杀了，不是脚本报错。关掉限制（需 adb 或 Shizuku）：

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
```

再配合 `termux-wake-lock`、把 Termux 电池优化设为「无限制」。

**`pip install` 卡在 `Installing build dependencies`**
说明在从源码编译 `pydantic-core`（Rust）。Termux 是 aarch64-android，PyPI 没有对应预编译包。用不需要编译的版本组合：

```bash
venv/bin/python -m pip install fastapi==0.115.6 "pydantic<2" uvicorn==0.34.0 \
  -i https://mirrors.aliyun.com/pypi/simple/
```

**端口 8000 被占**
后端固定 8000，因为模板前端把 `http://127.0.0.1:8000` 写死了。同时只能跑一个项目的后端；面板会提示是哪个项目占着，可先停它或强制接管。
