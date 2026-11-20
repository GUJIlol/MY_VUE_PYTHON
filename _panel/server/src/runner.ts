import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { BACKEND_PORT } from './config.js'
import { getProject, scanProjects, backendOwnerName, Project } from './projects.js'
import {
  clip,
  isAlive,
  isPortOpen,
  killTree,
  findPortOwners,
  readPid,
  readTail,
  stripAnsi,
  collectTree,
} from './utils.js'

export interface Step {
  title: string
  ok: boolean
  output?: string
}

export interface ActionResult {
  ok: boolean
  message: string
  steps: Step[]
  project?: Project | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function appendLog(logFile: string, label: string) {
  try {
    const time = new Date().toLocaleString('zh-CN', { hour12: false })
    fs.appendFileSync(logFile, `\n===== ${time} ${label} =====\n`)
  } catch {}
}

/** 以独立进程组（detached）启动，输出重定向到日志文件 */
function spawnToLog(
  cmd: string,
  args: string[],
  cwd: string,
  logFile: string,
  label: string
): number {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  appendLog(logFile, label)
  const fd = fs.openSync(logFile, 'a')
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, FORCE_COLOR: '0', CI: '1', TERM: 'dumb' },
  })
  fs.closeSync(fd)
  child.unref()
  if (!child.pid) throw new Error(`无法启动: ${cmd} ${args.join(' ')}`)
  return child.pid
}

function venvPython(backendDir: string): string {
  return path.join(backendDir, 'venv', 'bin', 'python')
}

/** 等端口起来，或进程提前退出 */
async function waitForPort(pid: number, port: number, timeoutMs: number): Promise<'open' | 'dead' | 'timeout'> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (!isAlive(pid)) return 'dead'
    if (await isPortOpen(port)) return 'open'
    await sleep(250)
  }
  return (await isPortOpen(port)) ? 'open' : 'timeout'
}

async function waitForFrontendUrl(logFile: string, timeoutMs: number): Promise<string | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const text = stripAnsi(readTail(logFile, 8000))
    const matches = text.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/g)
    if (matches && matches.length) return matches[matches.length - 1]
    await sleep(300)
  }
  return null
}

/** 停掉占用 8000 端口的“其他项目”（force 启动时使用，前后端一起停，与 start.sh 的 pkill 行为一致） */
async function stopOtherProjects(keepProject: string): Promise<string[]> {
  const stopped: string[] = []
  const projects = scanProjects()
  for (const p of projects) {
    if (p.name === keepProject) continue
    let touched = false
    for (const role of ['backend', 'frontend'] as const) {
      const pidFile = path.join(p.path, `.${role}.pid`)
      const pid = readPid(pidFile)
      if (!pid) continue
      if (isAlive(pid)) {
        killTree(pid, 'SIGTERM')
        touched = true
      }
      fs.rmSync(pidFile, { force: true })
    }
    if (touched) stopped.push(p.name)
  }

  // 还是有人占着 → 直接按端口找进程杀
  if (await isPortOpen(BACKEND_PORT)) {
    await sleep(800)
    for (const pid of findPortOwners(BACKEND_PORT)) {
      killTree(pid, 'SIGTERM')
      stopped.push(`pid ${pid}`)
    }
  }
  return stopped
}

async function waitPortFree(port: number, timeoutMs = 6000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (!(await isPortOpen(port))) return true
    await sleep(250)
  }
  return !(await isPortOpen(port))
}

export async function startProject(name: string, opts: { force?: boolean } = {}): Promise<ActionResult> {
  const steps: Step[] = []
  const project = getProject(name)
  if (!project) return { ok: false, message: `项目不存在: ${name}`, steps }

  if (project.backendRunning && project.frontendRunning) {
    return {
      ok: false,
      message: '该项目已在运行，如需重启请点“重启”',
      steps: [{ title: '检查运行状态', ok: false, output: `后端 PID ${project.backendPid}，前端 PID ${project.frontendPid}` }],
      project,
    }
  }

  // 清理脏 PID 文件
  for (const [file, alive] of [
    [path.join(project.path, '.backend.pid'), project.backendRunning],
    [path.join(project.path, '.frontend.pid'), project.frontendRunning],
  ] as Array<[string, boolean]>) {
    if (!alive) fs.rmSync(file, { force: true })
  }

  // 端口占用检查
  if (await isPortOpen(BACKEND_PORT)) {
    const owners = findPortOwners(BACKEND_PORT)
    const ownerName = backendOwnerName(scanProjects(), owners)
    if (!opts.force) {
      return {
        ok: false,
        message: ownerName
          ? `后端端口 ${BACKEND_PORT} 被项目「${ownerName}」占用，请先停止它，或使用强制启动`
          : `后端端口 ${BACKEND_PORT} 被未知进程占用（PID ${owners.join(', ') || '?'}）`,
        steps: [
          {
            title: '检查端口 ' + BACKEND_PORT,
            ok: false,
            output: `占用进程: ${owners.join(', ') || '未知'}`,
          },
        ],
        project,
      }
    }
    const stopped = await stopOtherProjects(name)
    const free = await waitPortFree(BACKEND_PORT)
    steps.push({
      title: `强制释放端口 ${BACKEND_PORT}`,
      ok: free,
      output: stopped.length ? `已停止: ${stopped.join(', ')}` : '未发现可停止的进程',
    })
    if (!free) return { ok: false, message: `端口 ${BACKEND_PORT} 仍被占用`, steps, project }
  }

  // 后端
  if (!project.backendRunning) {
    const py = venvPython(project.backendDir)
    if (!fs.existsSync(py)) {
      return {
        ok: false,
        message: '缺少 backend/venv，请先点“导出/导入”重建依赖，或用 new-game.sh 创建',
        steps: [{ title: '检查虚拟环境', ok: false, output: `未找到 ${py}` }],
        project,
      }
    }

    let backendPid: number
    try {
      backendPid = spawnToLog(
        py,
        ['-m', 'uvicorn', 'main:app', '--reload', '--port', String(BACKEND_PORT)],
        project.backendDir,
        path.join(project.path, 'backend.log'),
        'panel: start backend'
      )
    } catch (e: any) {
      return { ok: false, message: e?.message ?? '后端启动失败', steps, project }
    }
    fs.writeFileSync(path.join(project.path, '.backend.pid'), String(backendPid))
    steps.push({ title: '启动后端', ok: true, output: `PID ${backendPid} · ${py} -m uvicorn main:app` })

    const portState = await waitForPort(backendPid, BACKEND_PORT, 20000)
    steps.push({
      title: '等待后端监听 ' + BACKEND_PORT,
      ok: portState === 'open',
      output: portState === 'open' ? `http://127.0.0.1:${BACKEND_PORT}` : clip(readTail(path.join(project.path, 'backend.log'))),
    })
    if (portState !== 'open') {
      killTree(backendPid, 'SIGKILL')
      fs.rmSync(path.join(project.path, '.backend.pid'), { force: true })
      return {
        ok: false,
        message: portState === 'dead' ? '后端进程启动后退出，请查看后端日志' : '后端 20 秒内未监听端口',
        steps,
        project: getProject(name),
      }
    }
  } else {
    steps.push({ title: '后端已在运行', ok: true, output: `PID ${project.backendPid}` })
  }

  // 前端
  if (!project.frontendRunning) {
    if (!fs.existsSync(path.join(project.frontendDir, 'node_modules'))) {
      steps.push({ title: '警告：前端缺少 node_modules', ok: false, output: 'npm run dev 可能失败，请先导入或重建依赖' })
    }
    let frontendPid: number
    try {
      frontendPid = spawnToLog(
        'npm',
        ['run', 'dev'],
        project.frontendDir,
        path.join(project.path, 'frontend.log'),
        'panel: start frontend'
      )
    } catch (e: any) {
      return { ok: false, message: e?.message ?? '前端启动失败', steps, project: getProject(name) }
    }
    fs.writeFileSync(path.join(project.path, '.frontend.pid'), String(frontendPid))
    steps.push({ title: '启动前端', ok: true, output: `PID ${frontendPid} · npm run dev` })
  } else {
    steps.push({ title: '前端已在运行', ok: true, output: `PID ${project.frontendPid}` })
  }

  const updated = getProject(name)
  const url = updated?.frontendUrl ?? (await waitForFrontendUrl(path.join(project.path, 'frontend.log'), 15000))
  steps.push({
    title: '读取前端地址',
    ok: !!url,
    output: url ?? clip(readTail(path.join(project.path, 'frontend.log'))),
  })

  const failed = steps.some((s) => !s.ok)
  return {
    ok: !failed || !!url,
    message: url ? `启动完成：${url}` : '服务已启动，但前端地址暂未解析出来（可稍后刷新或看日志）',
    steps,
    project: getProject(name),
  }
}

export async function stopProject(name: string): Promise<ActionResult> {
  const steps: Step[] = []
  const project = getProject(name)
  if (!project) return { ok: false, message: `项目不存在: ${name}`, steps }

  let stopped = 0

  for (const role of ['backend', 'frontend'] as const) {
    const pid = readPid(path.join(project.path, `.${role}.pid`))
    if (!pid || !isAlive(pid)) {
      if (pid) fs.rmSync(path.join(project.path, `.${role}.pid`), { force: true })
      steps.push({ title: `${role === 'backend' ? '后端' : '前端'}未在运行`, ok: true, output: pid ? `清理过期 PID 文件 (${pid})` : '无 PID 文件' })
      continue
    }

    const tree = collectTree(pid)
    killTree(pid, 'SIGTERM')
    stopped++

    // 最多等 2.5s 正常退出
    const end = Date.now() + 2500
    while (Date.now() < end && isAlive(pid)) await sleep(250)
    let forced = false
    if (isAlive(pid)) {
      killTree(pid, 'SIGKILL')
      forced = true
    }
    fs.rmSync(path.join(project.path, `.${role}.pid`), { force: true })

    steps.push({
      title: `停止${role === 'backend' ? '后端' : '前端'}`,
      ok: true,
      output: `PID ${pid}，连带子进程 ${tree.length - 1} 个${forced ? '（已强制结束）' : ''}`,
    })
  }

  const updated = getProject(name)
  return {
    ok: true,
    message: stopped ? `已停止 ${stopped} 个服务` : '没有正在运行的服务',
    steps,
    project: updated,
  }
}

export async function restartProject(name: string): Promise<ActionResult> {
  const stopped = await stopProject(name)
  await waitPortFree(BACKEND_PORT, 8000)
  await sleep(300)
  const started = await startProject(name)
  return {
    ok: started.ok,
    message: started.ok
      ? `重启完成：${started.message.replace(/^启动完成：/, '')}`
      : `重启失败：${started.message}`,
    steps: [
      { title: '停止', ok: stopped.ok, output: stopped.message },
      ...started.steps,
    ],
    project: getProject(name),
  }
}
