import fs from 'node:fs'
import path from 'node:path'
import { PANEL_DIR } from './config.js'

/** 后端框架：starlette = 纯 Python 秒装；fastapi = 要现编译 pydantic-core（Rust） */
export type BackendKind = 'starlette' | 'fastapi'

/** 新建项目时可勾选的脚手架选项 */
export interface ScaffoldOptions {
  typescript: boolean
  router: boolean
  pinia: boolean
  eslint: boolean
  demo: boolean
  backend: BackendKind
}

export const DEFAULT_OPTIONS: ScaffoldOptions = {
  typescript: false,
  router: false,
  pinia: false,
  eslint: false,
  demo: true,
  backend: 'starlette',
}

export function normalizeOptions(raw: any): ScaffoldOptions {
  const pick = (k: 'typescript' | 'router' | 'pinia' | 'eslint' | 'demo') =>
    typeof raw?.[k] === 'boolean' ? raw[k] : DEFAULT_OPTIONS[k]
  return {
    typescript: pick('typescript'),
    router: pick('router'),
    pinia: pick('pinia'),
    eslint: pick('eslint'),
    demo: pick('demo'),
    backend: raw?.backend === 'fastapi' ? 'fastapi' : 'starlette',
  }
}

const PREFS_FILE = path.join(PANEL_DIR, 'server', '.create-prefs.json')

export function loadCreatePrefs(): ScaffoldOptions {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))
    return normalizeOptions(raw)
  } catch {
    return { ...DEFAULT_OPTIONS }
  }
}

export function saveCreatePrefs(options: ScaffoldOptions) {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(options, null, 2), { mode: 0o600 })
  } catch {}
}

export interface ScaffoldFile {
  path: string
  content: string
}

const BACKEND_MAIN_STARLETTE = `"""测试后端（Starlette）：/api/ping 返回 pong"""
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route


async def ping(request):
    return JSONResponse({"message": "pong from Python!"})


async def home(request):
    return JSONResponse({"ok": True, "service": "backend"})


app = Starlette(
    routes=[Route("/", home), Route("/api/ping", ping)],
    middleware=[
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    ],
)
`

const BACKEND_MAIN_FASTAPI = `"""测试后端（FastAPI）：/api/ping 返回 pong"""
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
`

const REQUIREMENTS_STARLETTE = `starlette
uvicorn
`

const REQUIREMENTS_FASTAPI = `fastapi
uvicorn
`

export function backendFiles(backend: BackendKind = 'starlette'): ScaffoldFile[] {
  const main = backend === 'fastapi' ? BACKEND_MAIN_FASTAPI : BACKEND_MAIN_STARLETTE
  const req = backend === 'fastapi' ? REQUIREMENTS_FASTAPI : REQUIREMENTS_STARLETTE
  return [
    { path: 'backend/main.py', content: main },
    { path: 'backend/requirements.txt', content: req },
  ]
}

const STYLE_CSS = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #111; color: #eee; font-family: system-ui, -apple-system, sans-serif; }
.wrap { padding: 32px; }
h1 { font-size: 20px; margin: 0 0 8px; }
h2 { font-size: 16px; margin: 24px 0 8px; }
.muted { color: #888; font-size: 13px; }
.btn {
  margin-top: 16px; padding: 10px 18px; font-size: 15px;
  border: 0; border-radius: 8px; background: #2a6; color: #fff; cursor: pointer;
}
.msg { margin-top: 16px; font-size: 15px; }
.counter { margin-top: 20px; }
`

function demoView(title: string, opts: ScaffoldOptions): string {
  const ts = opts.typescript
  const catchLine = ts
    ? "    msg.value = '❌ 连接失败：' + (e as Error).message"
    : "    msg.value = '❌ 连接失败：' + e.message"

  const piniaImport = opts.pinia ? "import { useCounterStore } from '../stores/counter'\n" : ''
  const piniaConst = opts.pinia ? 'const counter = useCounterStore()\n' : ''
  const piniaBlock = opts.pinia
    ? `    <div class="counter">
      <button class="btn" @click="counter.increment()">count is {{ counter.count }}（Pinia）</button>
    </div>
`
    : ''

  return `<template>
  <div class="wrap">
    <h1>${title}</h1>
    <p class="muted">Vue + ${opts.backend === 'fastapi' ? 'FastAPI' : 'Starlette'} 脚手架</p>
    <button class="btn" @click="test">测试连接后端</button>
    <p v-if="msg" class="msg">{{ msg }}</p>
${piniaBlock}  </div>
</template>

<script setup${ts ? ' lang="ts"' : ''}>
import { ref } from 'vue'
${piniaImport}
const msg = ref('')
${piniaConst}
async function test() {
  try {
    const r = await fetch('http://127.0.0.1:8000/api/ping')
    const d = await r.json()
    msg.value = '✅ 后端回复：' + d.message
  } catch (e) {
${catchLine}
  }
}
</script>
`
}

function blankView(title: string): string {
  return `<template>
  <div class="wrap">
    <h1>${title}</h1>
    <p class="muted">Vue + FastAPI</p>
  </div>
</template>
`
}

export function frontendFiles(opts: ScaffoldOptions, pkgName: string, title: string): ScaffoldFile[] {
  const ext = opts.typescript ? 'ts' : 'js'

  const deps: Record<string, string> = { vue: '^3.5.13' }
  const devDeps: Record<string, string> = {
    '@vitejs/plugin-vue': '^5.2.1',
    vite: '^6.0.7',
  }
  if (opts.typescript) devDeps.typescript = '^5.6.3'
  if (opts.router) deps['vue-router'] = '^4.5.0'
  if (opts.pinia) deps.pinia = '^2.2.6'
  if (opts.eslint) {
    devDeps.eslint = '^9.17.0'
    devDeps['@eslint/js'] = '^9.17.0'
    devDeps['eslint-plugin-vue'] = '^9.32.0'
    devDeps.globals = '^15.14.0'
    if (opts.typescript) devDeps['typescript-eslint'] = '^8.18.0'
  }

  const scripts: Record<string, string> = {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  }
  if (opts.eslint) scripts.lint = 'eslint .'

  const pkg = {
    name: pkgName,
    private: true,
    version: '0.0.1',
    type: 'module',
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
  }

  const viteConfig = `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { host: '127.0.0.1' },
})
`

  const indexHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.${ext}"></script>
  </body>
</html>
`

  const mainLines = [
    "import { createApp } from 'vue'",
    "import App from './App.vue'",
  ]
  if (opts.pinia) mainLines.push("import { createPinia } from 'pinia'")
  if (opts.router) mainLines.push("import router from './router'")
  mainLines.push("import './style.css'", '', 'const app = createApp(App)')
  if (opts.pinia) mainLines.push('app.use(createPinia())')
  if (opts.router) mainLines.push('app.use(router)')
  mainLines.push("app.mount('#app')")
  const main = mainLines.join('\n') + '\n'

  const view = opts.demo ? demoView(title, opts) : blankView(title)

  const routerFile = `import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/', name: 'home', component: HomeView }],
})

export default router
`

  const storeFile = opts.typescript
    ? `import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  getters: {
    double: (state) => state.count * 2,
  },
  actions: {
    increment() {
      this.count++
    },
  },
})
`
    : `import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  getters: {
    double: (state) => state.count * 2,
  },
  actions: {
    increment() {
      this.count++
    },
  },
})
`

  const eslintConfig = opts.typescript
    ? `import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  { languageOptions: { globals: { ...globals.browser } } },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } },
  { rules: { 'vue/multi-word-component-names': 'off' } },
]
`
    : `import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  { languageOptions: { globals: { ...globals.browser } } },
  { rules: { 'vue/multi-word-component-names': 'off' } },
]
`

  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": false,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue", "vite.config.ts"]
}
`

  const envDts = `/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}
`

  const gitignore = `node_modules
dist
*.log
.env.local
`

  const files: ScaffoldFile[] = [
    { path: 'frontend/package.json', content: JSON.stringify(pkg, null, 2) + '\n' },
    { path: `frontend/vite.config.${ext}`, content: viteConfig },
    { path: 'frontend/index.html', content: indexHtml },
    { path: `frontend/src/main.${ext}`, content: main },
    { path: 'frontend/src/style.css', content: STYLE_CSS },
    { path: 'frontend/src/App.vue', content: opts.router ? `<template>\n  <router-view />\n</template>\n` : view },
    { path: 'frontend/.gitignore', content: gitignore },
  ]

  if (opts.router) {
    files.push({ path: `frontend/src/router/index.${ext}`, content: routerFile })
    files.push({ path: 'frontend/src/views/HomeView.vue', content: view })
  }
  if (opts.pinia) files.push({ path: `frontend/src/stores/counter.${ext}`, content: storeFile })
  if (opts.eslint) files.push({ path: 'frontend/eslint.config.js', content: eslintConfig })
  if (opts.typescript) {
    files.push({ path: 'frontend/tsconfig.json', content: tsconfig })
    files.push({ path: 'frontend/src/env.d.ts', content: envDts })
  }

  return files
}

/** 预览：返回将要写入的全部文件（后端 + 前端） */
export function previewFiles(name: string, options: ScaffoldOptions): ScaffoldFile[] {
  const pkgName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return [...backendFiles(options.backend), ...frontendFiles(options, pkgName, name)]
}

export function summarizeOptions(options: ScaffoldOptions): string[] {
  const on: string[] = []
  if (options.typescript) on.push('TypeScript')
  if (options.router) on.push('Vue Router')
  if (options.pinia) on.push('Pinia')
  if (options.eslint) on.push('ESLint')
  if (options.demo) on.push('示例页')
  on.push(options.backend === 'fastapi' ? '后端 FastAPI' : '后端 Starlette')
  return on
}
