import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, BACKEND_PORT, EXPORTS_DIR, PANEL_DIR, PANEL_LOG, PORT, PROJECTS_DIR, TOKEN, WEB_DIR, ensureDirs } from './config.js'
import { backendOwnerName, getProject, scanProjects } from './projects.js'
import { streamLog } from './logs.js'
import { restartProject, startProject, stopProject } from './runner.js'
import { createProject, previewProject } from './create.js'
import { loadCreatePrefs } from './scaffold.js'
import { exportProject, importArchive, listExports, exportsPathOf } from './archive.js'
import { deleteExport, deleteProject } from './remove.js'
import { clip, exec, findPortOwners, isPortOpen, pythonBin, readTail, timestamp } from './utils.js'

if (!fs.existsSync(path.join(BASE, 'start.sh'))) {
  console.error(`❌ BASE 定位错误: ${BASE}`)
  process.exit(1)
}

ensureDirs()

const app = express()
app.use(express.json({ limit: '2mb' }))

/** 面板自己的操作日志 */
function logLine(msg: string) {
  try {
    fs.appendFileSync(PANEL_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

// 静态页面（_panel/web）
app.use('/', express.static(WEB_DIR, { index: 'index.html' }))

// token 校验：header 或 query 都接受（EventSource 不能带 header）
function checkToken(req: any, res: any): boolean {
  const fromHeader = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : ''
  const provided = fromHeader || fromQuery
  if (provided !== TOKEN) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

/** 同一个项目同时只允许一个写操作，避免并发把状态搞乱 */
const BUSY = new Set<string>()
function withLock(name: string, fn: () => Promise<any>): Promise<any> | null {
  if (BUSY.has(name)) return null
  BUSY.add(name)
  return fn().finally(() => BUSY.delete(name))
}

function handle(fn: (req: any, res: any) => Promise<any>) {
  return async (req: any, res: any) => {
    try {
      await fn(req, res)
    } catch (e: any) {
      logLine(`ERROR ${req.method} ${req.path}: ${e?.message ?? e}`)
      if (!res.headersSent) res.status(500).json({ ok: false, message: e?.message ?? 'internal error' })
    }
  }
}

// ========== 基础 ==========
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, base: BASE, panel: PANEL_DIR, port: PORT })
})

app.get(
  '/api/projects',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const projects = scanProjects()
    const open = await isPortOpen(BACKEND_PORT)
    const owners = open ? findPortOwners(BACKEND_PORT) : []
    res.json({
      ok: true,
      projects,
      backendPort: BACKEND_PORT,
      portOpen: open,
      portOwners: owners,
      portOwnerName: open ? backendOwnerName(projects, owners) : null,
      base: BASE,
    })
  })
)

app.get(
  '/api/env',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const [py, node, npm] = await Promise.all([
      exec(pythonBin(), ['-V'], { timeout: 10_000 }),
      exec('node', ['-v'], { timeout: 10_000 }),
      exec('npm', ['-v'], { timeout: 15_000 }),
    ])
    const df = await exec('df', ['-k', BASE], { timeout: 10_000 })
    const dfLine = df.output.trim().split('\n').pop() ?? ''
    const parts = dfLine.split(/\s+/)
    const availKb = Number(parts[3] ?? 0)
    const open = await isPortOpen(BACKEND_PORT)
    const owners = open ? findPortOwners(BACKEND_PORT) : []

    res.json({
      ok: true,
      base: BASE,
      python: clip(py.output, 200),
      node: clip(node.output, 200),
      npm: clip(npm.output, 200),
      diskFreeMB: Math.round(availKb / 1024),
      projects: scanProjects().length,
      exports: listExports().length,
      backendPort: BACKEND_PORT,
      portOpen: open,
      portOwners: owners,
      termux: !!process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux'),
    })
  })
)

// ========== 新建项目的脚手架选项 ==========
app.get(
  '/api/create/options',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    res.json({ ok: true, options: loadCreatePrefs() })
  })
)

app.get(
  '/api/create/preview',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const truthy = (v: any) => v === '1' || v === 'true' || v === true
    const options = {
      typescript: truthy(req.query.typescript),
      router: truthy(req.query.router),
      pinia: truthy(req.query.pinia),
      eslint: truthy(req.query.eslint),
      demo: req.query.demo === undefined ? true : truthy(req.query.demo),
      backend: req.query.backend === 'fastapi' ? 'fastapi' : 'starlette',
    }
    const preview = previewProject(req.query.name, options)
    res.json({ ok: true, ...preview })
  })
)

// ========== 项目操作 ==========
app.post(
  '/api/projects',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const { name, start, options } = req.body ?? {}
    const key = `create:${name}`
    const task = withLock(key, () => createProject(name, { start: start !== false, options }))
    if (!task) return res.status(409).json({ ok: false, message: '该操作正在执行中' })
    const result = await task
    logLine(`CREATE ${name} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

app.post(
  '/api/projects/:name/start',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const name = req.params.name
    const force = !!req.body?.force
    const task = withLock(name, () => startProject(name, { force }))
    if (!task) return res.status(409).json({ ok: false, message: '该项目正在执行其他操作' })
    const result = await task
    logLine(`START ${name}${force ? ' (force)' : ''} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

app.post(
  '/api/projects/:name/stop',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const name = req.params.name
    const task = withLock(name, () => stopProject(name))
    if (!task) return res.status(409).json({ ok: false, message: '该项目正在执行其他操作' })
    const result = await task
    logLine(`STOP ${name} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

app.post(
  '/api/projects/:name/restart',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const name = req.params.name
    const task = withLock(name, () => restartProject(name))
    if (!task) return res.status(409).json({ ok: false, message: '该项目正在执行其他操作' })
    const result = await task
    logLine(`RESTART ${name} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

app.post(
  '/api/projects/:name/export',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const name = req.params.name
    const task = withLock(name, () => exportProject(name))
    if (!task) return res.status(409).json({ ok: false, message: '该项目正在执行其他操作' })
    const result = await task
    logLine(`EXPORT ${name} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

app.post(
  '/api/projects/:name/delete',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const name = req.params.name
    const confirm = req.body?.confirm
    const task = withLock(name, () => deleteProject(name, confirm))
    if (!task) return res.status(409).json({ ok: false, message: '该项目正在执行其他操作' })
    const result = await task
    logLine(`DELETE ${name} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

// ========== 日志 ==========
app.get('/api/logs/:name/:role', (req, res) => {
  if (!checkToken(req, res)) return
  const { name, role } = req.params as { name: string; role: string }
  if (!['backend', 'frontend'].includes(role)) {
    return res.status(400).json({ ok: false, message: 'role must be backend or frontend' })
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    return res.status(400).json({ ok: false, message: 'invalid name' })
  }
  const logPath = path.join(PROJECTS_DIR, name, `${role}.log`)
  if (!logPath.startsWith(PROJECTS_DIR + path.sep)) {
    return res.status(400).json({ ok: false, message: 'invalid path' })
  }
  streamLog(res, logPath)
})

app.get('/api/panel/log', (req, res) => {
  if (!checkToken(req, res)) return
  streamLog(res, PANEL_LOG)
})

// ========== 导入导出 ==========
app.get(
  '/api/exports',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    res.json({ ok: true, exports: listExports() })
  })
)

app.get('/api/exports/download/:file', (req, res) => {
  if (!checkToken(req, res)) return
  const p = exportsPathOf(req.params.file)
  if (!p) return res.status(404).json({ ok: false, message: '文件不存在' })
  res.download(p)
})

app.delete('/api/exports/:file', (req, res) => {
  if (!checkToken(req, res)) return
  const result = deleteExport(req.params.file)
  logLine(`DELETE-EXPORT ${req.params.file} → ${result.ok ? 'ok' : 'fail'}`)
  res.json(result)
})

app.post(
  '/api/import/archive',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const file = req.body?.file
    const p = exportsPathOf(file)
    if (!p) return res.status(404).json({ ok: false, message: `exports 里找不到: ${file}` })
    const task = withLock('import', () => importArchive(p))
    if (!task) return res.status(409).json({ ok: false, message: '导入正在执行中' })
    const result = await task
    logLine(`IMPORT ${file} → ${result.ok ? 'ok' : 'fail'}: ${result.message}`)
    res.json(result)
  })
)

// 浏览器直接上传 tar.gz（application/octet-stream）
app.post(
  '/api/import/upload',
  express.raw({ type: 'application/octet-stream', limit: '800mb' }),
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    const buf: Buffer = req.body
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ ok: false, message: '空文件' })
    }
    const filename = String(req.query.filename ?? 'upload.tar.gz')
    if (!/\.tar\.gz$/i.test(filename)) {
      return res.status(400).json({ ok: false, message: '只支持 .tar.gz' })
    }
    fs.mkdirSync(EXPORTS_DIR, { recursive: true })
    const saved = path.join(EXPORTS_DIR, `_upload_${timestamp()}.tar.gz`)
    fs.writeFileSync(saved, buf)
    logLine(`UPLOAD ${filename} (${buf.length} bytes) → ${path.basename(saved)}`)

    const task = withLock('import', () => importArchive(saved))
    if (!task) return res.status(409).json({ ok: false, message: '导入正在执行中' })
    const result = await task
    // 导入成功的临时上传文件删掉，避免 exports/ 里堆一堆 _upload_
    if (result.ok) {
      try {
        fs.rmSync(saved, { force: true })
      } catch {}
    }
    res.json(result)
  })
)

// ========== 面板自身 ==========
app.get(
  '/api/panel/info',
  handle(async (req, res) => {
    if (!checkToken(req, res)) return
    res.json({
      ok: true,
      pid: process.pid,
      uptime: process.uptime(),
      panelLogTail: clip(readTail(PANEL_LOG, 4000), 4000),
    })
  })
)

app.listen(PORT, '127.0.0.1', () => {
  console.log(`panel server: http://127.0.0.1:${PORT}`)
  console.log(`BASE: ${BASE}`)
  console.log(`token: ${TOKEN.slice(0, 8)}...（完整见 ${path.join(PANEL_DIR, 'server', '.token')}）`)
  console.log(`open: http://127.0.0.1:${PORT}/?token=${TOKEN}`)
})
