import fs from 'node:fs'
import path from 'node:path'
import { BACKEND_PORT, PROJECTS_DIR } from './config.js'
import { collectTree, isAlive, readCmdline, readPid, readTail, stripAnsi } from './utils.js'

export interface Project {
  name: string
  path: string
  backendDir: string
  frontendDir: string
  frontendLayout: 'frontend' | 'vue-project'
  backendPid: number | null
  frontendPid: number | null
  backendRunning: boolean
  frontendRunning: boolean
  backendStale: boolean
  frontendStale: boolean
  frontendUrl: string | null
  backendUrl: string
  hasBackendLog: boolean
  hasFrontendLog: boolean
  hasVenv: boolean
  hasNodeModules: boolean
  /** main.py 用的是 FastAPI 才会自动带 /docs */
  hasDocs: boolean
  updatedAt: number
}

const PID_MARKERS: Record<'backend' | 'frontend', string[]> = {
  backend: ['uvicorn', 'main:app', 'python'],
  frontend: ['npm', 'node', 'vite', 'sh', 'npm-cli'],
}

/** pid 文件里的进程活着，但命令行不像目标服务 → 认为 PID 被复用（脏数据） */
function statusOf(pid: number | null, role: 'backend' | 'frontend') {
  if (!pid || !isAlive(pid)) return { pid: pid ?? null, running: false, stale: false }
  const cmd = readCmdline(pid).toLowerCase()
  if (!cmd) return { pid, running: true, stale: false }
  const like = PID_MARKERS[role].some((m) => cmd.includes(m))
  return { pid, running: true, stale: !like }
}

function readFrontendUrl(logFile: string): string | null {
  try {
    const text = stripAnsi(readTail(logFile, 8000))
    const matches = text.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/g)
    return matches && matches.length > 0 ? matches[matches.length - 1] : null
  } catch {
    return null
  }
}

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

export function getProject(name: string): Project | null {
  return scanProjects().find((p) => p.name === name) ?? null
}

export function scanProjects(base = PROJECTS_DIR): Project[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    return []
  }

  const projects: Project[] = []

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const name = ent.name
    if (name === '_panel' || name === 'exports' || name === 'node_modules') continue

    const root = path.join(base, name)
    if (!fs.existsSync(path.join(root, 'backend', 'main.py'))) continue

    let frontendDir: string | null = null
    let layout: 'frontend' | 'vue-project' = 'frontend'
    if (fs.existsSync(path.join(root, 'frontend', 'package.json'))) {
      frontendDir = path.join(root, 'frontend')
      layout = 'frontend'
    } else if (fs.existsSync(path.join(root, 'frontend', 'vue-project', 'package.json'))) {
      frontendDir = path.join(root, 'frontend', 'vue-project')
      layout = 'vue-project'
    }
    if (!frontendDir) continue

    let hasDocs = false
    try {
      const mainPy = fs.readFileSync(path.join(root, 'backend', 'main.py'), 'utf8')
      hasDocs = /(from|import)\s+fastapi/i.test(mainPy)
    } catch {}

    const be = statusOf(readPid(path.join(root, '.backend.pid')), 'backend')
    const fe = statusOf(readPid(path.join(root, '.frontend.pid')), 'frontend')
    const frontendLog = path.join(root, 'frontend.log')

    projects.push({
      name,
      path: root,
      backendDir: path.join(root, 'backend'),
      frontendDir,
      frontendLayout: layout,
      backendPid: be.pid,
      frontendPid: fe.pid,
      backendRunning: be.running,
      frontendRunning: fe.running,
      backendStale: be.stale,
      frontendStale: fe.stale,
      frontendUrl: readFrontendUrl(frontendLog),
      backendUrl: `http://127.0.0.1:${BACKEND_PORT}`,
      hasBackendLog: fs.existsSync(path.join(root, 'backend.log')),
      hasFrontendLog: fs.existsSync(frontendLog),
      hasVenv: fs.existsSync(path.join(root, 'backend', 'venv', 'bin', 'python')),
      hasNodeModules: fs.existsSync(path.join(frontendDir, 'node_modules')),
      hasDocs,
      updatedAt: Math.max(
        mtime(path.join(root, 'backend', 'main.py')),
        mtime(path.join(frontendDir, 'src', 'App.vue')),
        mtime(path.join(frontendDir, 'package.json'))
      ),
    })
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

/** 当前占用 8000 端口的项目名（能对应上时） */
export function backendOwnerName(projects: Project[], owners: number[]): string | null {
  for (const p of projects) {
    if (!p.backendPid) continue
    for (const pid of owners) {
      if (pid === p.backendPid) return p.name
      if (collectTree(p.backendPid).includes(pid)) return p.name
    }
  }
  return null
}
