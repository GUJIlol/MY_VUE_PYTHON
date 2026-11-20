import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** _panel 目录 */
export const PANEL_DIR = path.resolve(__dirname, '../..')
/** 工作区根目录（start.sh 所在目录） */
export const BASE = path.resolve(PANEL_DIR, '..')
export const WEB_DIR = path.join(PANEL_DIR, 'web')
export const LOGS_DIR = path.join(PANEL_DIR, 'logs')
export const PANEL_LOG = path.join(LOGS_DIR, 'panel.log')
export const EXPORTS_DIR = path.join(BASE, 'exports')
/** 业务项目统一放在 projects/ 下（仓库只提交管理器，不提交项目） */
export const PROJECTS_DIR = path.join(BASE, 'projects')

export const PORT = 7000
/** 所有项目共用后端端口，与 start.sh 保持一致 */
export const BACKEND_PORT = 8000

function loadToken(): string {
  const file = path.join(PANEL_DIR, 'server', '.token')
  try {
    const t = fs.readFileSync(file, 'utf8').trim()
    if (t) return t
  } catch {}
  const token = crypto.randomBytes(24).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token, { mode: 0o600 })
  return token
}

export const TOKEN = loadToken()

export function ensureDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  fs.mkdirSync(EXPORTS_DIR, { recursive: true })
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
}
