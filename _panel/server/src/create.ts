import fs from 'node:fs'
import path from 'node:path'
import { PANEL_DIR, PROJECTS_DIR } from './config.js'
import { ActionResult, Step, startProject } from './runner.js'
import { getProject } from './projects.js'
import { clip, exec, pythonBin, safeName } from './utils.js'
import {
  normalizeOptions,
  previewFiles,
  saveCreatePrefs,
  summarizeOptions,
} from './scaffold.js'

const PIP_MIRROR = 'https://mirrors.aliyun.com/pypi/simple/'
const NPM_MIRROR = 'https://registry.npmmirror.com'

function writeFile(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/** 创建过程的进度落到文件，面板被系统杀掉后还能看到卡在哪一步 */
function progressLog(name: string) {
  const file = path.join(PANEL_DIR, 'logs', `create-${name}.log`)
  return (line: string) => {
    try {
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`)
    } catch {}
  }
}

/** 预览将生成的文件（不落盘），用于新建弹窗里的“预览” */
export function previewProject(rawName: unknown, rawOptions: unknown) {
  const name = safeName(rawName) ?? 'my-app'
  const options = normalizeOptions(rawOptions)
  return {
    name,
    options,
    summary: summarizeOptions(options),
    files: previewFiles(name, options),
  }
}

/** 创建项目：venv + fastapi/uvicorn + 按选项生成的 Vue 脚手架 + npm install */
export async function createProject(
  rawName: unknown,
  opts: { start?: boolean; options?: unknown } = {}
): Promise<ActionResult> {
  const steps: Step[] = []
  const name = safeName(rawName)
  if (!name) {
    return { ok: false, message: '项目名不合法：只能用字母/数字/-/_，且不能是 _panel、exports', steps }
  }
  if (!/^[A-Za-z]/.test(name)) {
    return { ok: false, message: '项目名必须以字母开头', steps }
  }

  const root = path.join(PROJECTS_DIR, name)
  if (fs.existsSync(root)) {
    return { ok: false, message: `目录已存在: ${name}`, steps }
  }

  const options = normalizeOptions(opts.options)
  const enabled = summarizeOptions(options)
  const py = pythonBin()
  const log = progressLog(name)
  log(`开始创建 ${name}｜选项: ${enabled.join(' / ')}`)

  steps.push({ title: '创建目录', ok: true, output: `mkdir -p ${name}/backend ${name}/frontend` })
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true })
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true })

  // 先把所有脚手架文件写出来（后端 + 前端），失败可整体删掉
  const files = previewFiles(name, options)
  for (const f of files) writeFile(path.join(root, f.path), f.content)
  steps.push({
    title: `写入脚手架（${files.length} 个文件）`,
    ok: true,
    output: `选项: ${enabled.length ? enabled.join(' / ') : '无（最小模板）'}\n` + files.map((f) => f.path).join('\n'),
  })
  log(`写入 ${files.length} 个脚手架文件`)

  const venv = await exec(py, ['-m', 'venv', 'venv'], { cwd: path.join(root, 'backend'), timeout: 120_000 })
  steps.push({ title: '创建 Python 虚拟环境', ok: venv.code === 0, output: clip(venv.output) })
  log(`venv → ${venv.code === 0 ? 'ok' : 'fail'}`)
  if (venv.code !== 0) {
    return { ok: false, message: 'venv 创建失败（Termux 需 pkg install python）', steps }
  }

  const isFastapi = options.backend === 'fastapi'
  const pip = await exec(
    path.join(root, 'backend', 'venv', 'bin', 'python'),
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt', '-i', PIP_MIRROR],
    { cwd: path.join(root, 'backend'), timeout: isFastapi ? 900_000 : 300_000 }
  )
  steps.push({
    title: isFastapi ? '安装后端依赖 fastapi + uvicorn（需编译 pydantic-core）' : '安装后端依赖 starlette + uvicorn',
    ok: pip.code === 0,
    output: clip(pip.output),
  })
  log(`pip(${options.backend}) → ${pip.code === 0 ? 'ok' : 'fail'}`)
  if (pip.code !== 0) {
    return {
      ok: false,
      message: isFastapi
        ? 'FastAPI 装不上：Termux 上 pydantic-core 要现场编译。先 pkg install rust binutils clang，或改用 Starlette 后端'
        : '后端依赖安装失败（检查网络或换镜像源）',
      steps,
    }
  }

  let npm = await exec('npm', ['install', '--no-audit', '--no-fund', `--registry=${NPM_MIRROR}`], {
    cwd: path.join(root, 'frontend'),
    timeout: 300_000,
  })
  if (npm.code !== 0) {
    steps.push({ title: '首次安装失败，改用默认源重试', ok: false, output: clip(npm.output, 1500) })
    npm = await exec('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: path.join(root, 'frontend'),
      timeout: 300_000,
    })
  }
  steps.push({ title: '安装前端依赖 npm install', ok: npm.code === 0, output: clip(npm.output) })
  log(`npm install → ${npm.code === 0 ? 'ok' : 'fail'}`)
  if (npm.code !== 0) {
    return { ok: false, message: '前端依赖安装失败', steps }
  }

  saveCreatePrefs(options)

  if (opts.start !== false) {
    const started = await startProject(name)
    steps.push(...started.steps)
    return {
      ok: started.ok,
      message: started.ok ? started.message : `项目已创建，但启动失败：${started.message}`,
      steps,
      project: getProject(name),
    }
  }

  return {
    ok: true,
    message: `项目已创建: ${name}（未启动）`,
    steps,
    project: getProject(name),
  }
}
