import fs from 'node:fs'
import path from 'node:path'
import { BASE, EXPORTS_DIR, PROJECTS_DIR } from './config.js'
import { getProject, Project } from './projects.js'
import { ActionResult, Step } from './runner.js'
import { clip, exec, fmtBytes, pythonBin, safeName, timestamp } from './utils.js'

const PIP_MIRROR = 'https://mirrors.aliyun.com/pypi/simple/'
const NPM_MIRROR = 'https://registry.npmmirror.com'

export interface ExportResult extends ActionResult {
  archive?: { file: string; size: number }
}

function exclusions(name: string): string[] {
  const list = [
    `${name}/backend/venv`,
    `${name}/backend/__pycache__`,
    `${name}/frontend/node_modules`,
    `${name}/frontend/vue-project/node_modules`,
    `${name}/*.log`,
    `${name}/.backend.pid`,
    `${name}/.frontend.pid`,
  ]
  return list.map((x) => `--exclude=${x}`)
}

/** 生成 requirements.txt 并打包到 exports/ */
export async function exportProject(rawName: unknown): Promise<ExportResult> {
  const steps: Step[] = []
  const name = safeName(rawName)
  if (!name) return { ok: false, message: '项目名不合法', steps }

  const project = getProject(name)
  if (!project) return { ok: false, message: `项目不存在: ${name}`, steps }

  const py = path.join(project.backendDir, 'venv', 'bin', 'python')
  if (fs.existsSync(py)) {
    const freeze = await exec(py, ['-m', 'pip', 'freeze'], { cwd: project.backendDir, timeout: 30_000 })
    if (freeze.code === 0 && freeze.output.trim()) {
      fs.writeFileSync(path.join(project.backendDir, 'requirements.txt'), freeze.output)
      steps.push({ title: '生成 requirements.txt', ok: true, output: `${freeze.output.trim().split('\n').length} 个依赖` })
    } else {
      steps.push({ title: '生成 requirements.txt', ok: false, output: 'pip freeze 无输出，跳过' })
    }
  } else {
    steps.push({ title: '跳过 requirements.txt', ok: false, output: '没有 backend/venv，无法 pip freeze' })
  }

  fs.mkdirSync(EXPORTS_DIR, { recursive: true })
  const archive = path.join(EXPORTS_DIR, `${name}_${timestamp()}.tar.gz`)

  const tar = await exec('tar', ['-czf', archive, ...exclusions(name), name], {
    cwd: PROJECTS_DIR,
    timeout: 180_000,
  })
  if (tar.code !== 0 || !fs.existsSync(archive)) {
    steps.push({ title: '打包 tar.gz', ok: false, output: clip(tar.output) })
    return { ok: false, message: '打包失败', steps }
  }

  const size = fs.statSync(archive).size
  steps.push({ title: '打包 tar.gz', ok: true, output: `${path.basename(archive)} · ${fmtBytes(size)}` })

  return {
    ok: true,
    message: `打包完成：${path.basename(archive)}（${fmtBytes(size)}）`,
    steps,
    archive: { file: path.basename(archive), size },
    project,
  }
}

export interface ExportItem {
  file: string
  size: number
  time: number
}

export function listExports(): ExportItem[] {
  try {
    return fs
      .readdirSync(EXPORTS_DIR)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => {
        const p = path.join(EXPORTS_DIR, f)
        const st = fs.statSync(p)
        return { file: f, size: st.size, time: st.mtimeMs }
      })
      .sort((a, b) => b.time - a.time)
  } catch {
    return []
  }
}

export function exportsPathOf(file: unknown): string | null {
  if (typeof file !== 'string' || !/^[A-Za-z0-9._-]+\.tar\.gz$/.test(file)) return null
  const p = path.join(EXPORTS_DIR, file)
  return fs.existsSync(p) ? p : null
}

/** 校验压缩包：返回顶层目录名 */
async function inspectArchive(archive: string): Promise<{ name: string | null; error?: string; listing?: string }> {
  const r = await exec('tar', ['-tzf', archive], { timeout: 30_000 })
  if (r.code !== 0) return { name: null, error: '不是有效的 tar.gz 压缩包' }

  const entries = r.output.split('\n').filter(Boolean)
  if (entries.length === 0) return { name: null, error: '压缩包是空的' }

  const top = entries[0].split('/')[0]
  if (!safeName(top)) return { name: null, error: `压缩包顶层目录名不合法: ${top}` }

  for (const e of entries) {
    if (e.startsWith('/') || e.includes('..')) {
      return { name: null, error: `压缩包包含非法路径: ${e}` }
    }
    if (!e.startsWith(top + '/')) {
      return { name: null, error: `压缩包结构异常（存在多顶层目录）: ${e}` }
    }
  }
  return { name: top, listing: entries.slice(0, 30).join('\n') }
}

export interface ImportResult extends ActionResult {
  archiveFile?: string
}

/** 从压缩包导入并重建依赖 */
export async function importArchive(archive: string): Promise<ImportResult> {
  const steps: Step[] = []
  const archiveFile = path.basename(archive)

  if (!fs.existsSync(archive)) return { ok: false, message: `文件不存在: ${archiveFile}`, steps }

  const info = await inspectArchive(archive)
  if (info.error || !info.name) {
    return { ok: false, message: info.error ?? '压缩包校验失败', steps: [{ title: '校验压缩包', ok: false, output: info.error }] }
  }
  const name = info.name
  const root = path.join(PROJECTS_DIR, name)
  steps.push({ title: '校验压缩包', ok: true, output: `${archiveFile} → 项目 ${name}` })

  if (fs.existsSync(root)) {
    return {
      ok: false,
      message: `目标目录已存在: ${name}，请先删除或改名后再导入`,
      steps: [{ title: '检查目标目录', ok: false, output: root }],
    }
  }

  const untar = await exec('tar', ['-xzf', archive, '-C', PROJECTS_DIR], { timeout: 180_000 })
  steps.push({ title: '解压到工作区', ok: untar.code === 0, output: clip(untar.output) })
  if (untar.code !== 0) return { ok: false, message: '解压失败', steps }

  const project: Project | null = getProject(name)
  if (!project) {
    return { ok: false, message: '解压后没有识别到有效项目（缺 backend/main.py 或前端 package.json）', steps }
  }

  // 后端依赖
  const py = pythonBin()
  const venvPy = path.join(project.backendDir, 'venv', 'bin', 'python')
  if (!fs.existsSync(venvPy)) {
    const venv = await exec(py, ['-m', 'venv', 'venv'], { cwd: project.backendDir, timeout: 120_000 })
    steps.push({ title: '重建虚拟环境', ok: venv.code === 0, output: clip(venv.output) })
  }

  if (fs.existsSync(venvPy)) {
    const hasReq = fs.existsSync(path.join(project.backendDir, 'requirements.txt'))
    const pip = await exec(
      venvPy,
      hasReq
        ? ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt', '-i', PIP_MIRROR]
        : ['-m', 'pip', 'install', '--disable-pip-version-check', 'fastapi', 'uvicorn', '-i', PIP_MIRROR],
      { cwd: project.backendDir, timeout: 300_000 }
    )
    steps.push({
      title: hasReq ? '安装 requirements.txt' : '安装基础依赖 fastapi + uvicorn',
      ok: pip.code === 0,
      output: clip(pip.output),
    })
  }

  // 前端依赖
  if (!fs.existsSync(path.join(project.frontendDir, 'node_modules'))) {
    let npm = await exec('npm', ['install', '--no-audit', '--no-fund', `--registry=${NPM_MIRROR}`], {
      cwd: project.frontendDir,
      timeout: 300_000,
    })
    if (npm.code !== 0) {
      steps.push({ title: '首次安装失败，改用默认源重试', ok: false, output: clip(npm.output, 1500) })
      npm = await exec('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: project.frontendDir,
        timeout: 300_000,
      })
    }
    steps.push({ title: '安装前端依赖 npm install', ok: npm.code === 0, output: clip(npm.output) })
  } else {
    steps.push({ title: '前端依赖已存在', ok: true, output: '跳过 npm install' })
  }

  // 修可执行位（解压常见问题）
  const binDir = path.join(project.frontendDir, 'node_modules', '.bin')
  if (fs.existsSync(binDir)) {
    await exec('chmod', ['-R', 'a+x', binDir], { timeout: 30_000 })
    steps.push({ title: '修复 node_modules/.bin 可执行位', ok: true })
  }

  const failed = steps.some((s) => !s.ok)
  return {
    ok: !failed,
    message: failed ? `导入完成，但有步骤失败（可稍后手动重试）: ${name}` : `导入完成: ${name}`,
    steps,
    project: getProject(name),
    archiveFile,
  }
}
