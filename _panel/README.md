# 项目管理器（_panel）

把根目录那 6 个脚本（start / stop / new-game / import / export / delete）做成网页可视化，手机上直接点按钮。

## 启动 / 停止面板

```bash
cd _panel
./run.sh            # 启动，并打印一键登录地址
./run.sh status     # 看是否在运行 + 地址
./run.sh stop       # 停止
./run.sh url        # 只输出带 token 的地址
```

首次运行会自动 `npm install`（发布包里没有带 `node_modules`，因为它是按设备架构编译的）。

启动后终端会打印：

```
http://127.0.0.1:7000/?token=xxxxxxxx
```

直接点开这个地址就会自动登录（token 会存到浏览器 localStorage，下次不用再输）。只打开 `http://127.0.0.1:7000` 会要求粘贴 token，token 在 `_panel/server/.token`。

## 功能对照

| 页面操作 | 对应脚本 | 说明 |
|---|---|---|
| 项目卡片 + 状态灯 | `start.sh` 的扫描逻辑 | 扫描 `*/backend/main.py` + `frontend(/vue-project)/package.json` |
| 启动 / 停止 / 重启 | `start.sh` / `stop.sh` | 直接调 venv 里的 python 起 uvicorn，`npm run dev` 起前端；PID 写 `.backend.pid` / `.frontend.pid` |
| 新建项目 | `new-game.sh` | 建 venv、装后端依赖（**Starlette 纯 Python 秒装** / FastAPI 需编译 pydantic-core）、按**勾选项**生成 Vue3+Vite 脚手架（TypeScript / Vue Router / Pinia / ESLint / 示例页）、`npm install`、可选立即启动；弹窗内可预览将生成的每个文件 |
| 导入项目 | `import.sh` | 支持从手机选 `.tar.gz` 上传，或用 `exports/` 里已有的包；自动重建 venv / node_modules |
| 导出 / 打包记录 | `export.sh` | `pip freeze` 生成 requirements.txt 后打包到 `exports/`，可下载到手机，也可删除 |
| 删除项目 | `delete.sh` | 先停服务，再要求**手动输入项目名**才删，防止误点 |
| 日志 | — | 后端 / 前端日志 SSE 实时滚动，自动去 ANSI 颜色码 |
| 环境 | `new-game.sh` 的环境检查 | Python / Node / npm 版本、磁盘、8000 端口占用、Termux 检测 |

面板和脚本**可以混用**：都靠项目根目录的 `.backend.pid` / `.frontend.pid`、`backend.log` / `frontend.log` 通信，格式一致。

## 前端脚手架选项（方案 A）

新建弹窗里有 5 个开关，文件全部由 `_panel` 自己拼模板写盘，**不调用 `npm create vue@latest`**：面板是非交互进程，create-vue 的提问项还会随版本漂移，直接写死模板最稳。

| 开关 | 额外生成 / 变化 |
|---|---|
| TypeScript | `vite.config.ts`、`src/main.ts`、`tsconfig.json`、`src/env.d.ts`，其余入口后缀跟着变 `.ts` |
| Vue Router | `src/router/index.ts`、`src/views/HomeView.vue`，`App.vue` 变成只放 `<router-view />` |
| Pinia | `src/stores/counter.ts`，`main` 里 `createPinia()` |
| ESLint | `eslint.config.js`（flat config，vue + typescript-eslint），`package.json` 加 `lint` 脚本 |
| 示例页 | 页面里带「测试连接后端」按钮，请求 `http://127.0.0.1:8000/api/ping` |

不开任何开关时就是最小模板：`App.vue` 单页、只有 vue + vite 两个依赖。

- 弹窗里的 **预览生成的文件** 会先问后端要一份不落盘的清单（路径 + 内容），勾选项一改就自动刷新，创建前可以先看会写出什么。
- 上次创建成功的选择会存到 `server/.create-prefs.json`，下次打开弹窗自动带出来。

相关接口：

```
GET  /api/create/options                        # 上次的选项
GET  /api/create/preview?name=x&typescript=1&router=1&pinia=1&eslint=1&demo=1
POST /api/projects  { "name": "x", "start": true, "options": { ... } }
```

## 需要知道的限制

1. **后端端口固定 8000**（和 `start.sh` 一致，因为项目前端代码里写死了 `http://127.0.0.1:8000`）。所以同一时间只能跑一个后端。
   - 启动别的项目时如果 8000 被占，会提示是谁占的，可以选择**强制接管**：会停掉占用项目的前后端（和 `start.sh` 里的 `pkill uvicorn/vite` 行为一致）。
2. **前端端口由 Vite 自动分配**（5173、5174…），面板从 `frontend.log` 里解析真实地址，不会写死。
3. 停止时按进程树杀（`/proc` 里找子进程），能带走 `npm → sh → vite` 整条链，不会留僵尸；同时会校验 PID 命令行，PID 被复用不会误杀。
4. 打包默认排除 `venv`、`node_modules`、日志、PID 文件，所以包很小（几十 KB），导入时再重建依赖。
5. 面板只监听 `127.0.0.1:7000`，不对外网开放；所有写操作都要 token。

## 目录

```
_panel/
├── run.sh               # 启停脚本
├── server/src/
│   ├── index.ts         # 路由 + 鉴权
│   ├── config.ts        # 路径 / 端口 / token
│   ├── utils.ts         # 进程树、端口占用、命令执行等
│   ├── projects.ts      # 项目扫描与状态
│   ├── runner.ts        # 启动 / 停止 / 重启
│   ├── create.ts        # 新建项目流程（校验 / 写盘 / venv / pip / npm / 启动）
│   ├── scaffold.ts      # 前端脚手架：选项归一化、模板生成、预览、偏好持久化
│   ├── archive.ts       # 导出 / 导入 / 打包记录
│   ├── remove.ts        # 删除项目 / 删除打包
│   └── logs.ts          # SSE 日志流
└── web/                 # 无构建，纯 HTML/CSS/JS
    ├── index.html
    ├── style.css
    └── app.js
```
