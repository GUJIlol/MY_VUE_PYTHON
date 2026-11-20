import fs from 'node:fs'
import path from 'node:path'
import { BASE, PROJECTS_DIR } from './config.js'
import { getProject } from './projects.js'
import { ActionResult, Step, stopProject } from './runner.js'
import { safeName } from './utils.js'

/** 删除项目目录（先停服务，名字必须二次确认） */
export async function deleteProject(rawName: unknown, confirm: unknown): Promise<ActionResult> {
  const steps: Step[] = []
  const name = safeName(rawName)
  if (!name) return { ok: false, message: '项目名不合法', steps }

  if (confirm !== name) {
    return {
      ok: false,
      message: '确认名称不一致，已取消删除',
      steps: [{ title: '二次确认', ok: false, output: `需要输入: ${name}` }],
    }
  }

  const root = path.join(PROJECTS_DIR, name)
  if (!fs.existsSync(root)) return { ok: false, message: `目录不存在: ${name}`, steps }

  // 路径保险：必须在 projects/ 下、且不是 projects/ 本身
  const resolved = path.resolve(root)
  if (resolved === path.resolve(PROJECTS_DIR) || !resolved.startsWith(path.resolve(PROJECTS_DIR) + path.sep)) {
    return { ok: false, message: '路径校验失败，已取消', steps }
  }

  const project = getProject(name)
  if (project && (project.backendRunning || project.frontendRunning)) {
    const stopped = await stopProject(name)
    steps.push({ title: '停止正在运行的服务', ok: stopped.ok, output: stopped.message })
  } else {
    steps.push({ title: '服务未运行', ok: true })
  }

  try {
    fs.rmSync(resolved, { recursive: true, force: true })
  } catch (e: any) {
    return { ok: false, message: `删除失败: ${e?.message ?? e}`, steps }
  }

  if (fs.existsSync(resolved)) {
    return { ok: false, message: '删除后目录仍存在（可能有进程占用）', steps }
  }

  steps.push({ title: '删除目录', ok: true, output: resolved })
  return { ok: true, message: `已删除项目: ${name}`, steps, project: null }
}

export function deleteExport(file: unknown): ActionResult {
  if (typeof file !== 'string' || !/^[A-Za-z0-9._-]+\.tar\.gz$/.test(file)) {
    return { ok: false, message: '文件名不合法', steps: [] }
  }
  const p = path.join(BASE, 'exports', file)
  try {
    fs.rmSync(p, { force: true })
    return { ok: true, message: `已删除打包文件: ${file}`, steps: [] }
  } catch (e: any) {
    return { ok: false, message: `删除失败: ${e?.message ?? e}`, steps: [] }
  }
}
