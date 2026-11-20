import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

export interface ExecResult {
  code: number
  output: string
  timedOut: boolean
}

/** 执行命令并收集输出（stdout+stderr），支持超时强杀 */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    let timedOut = false

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const push = (chunk: Buffer | string) => {
      out += String(chunk)
      if (out.length > 400_000) out = out.slice(-200_000)
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    const timer = opts.timeout
      ? setTimeout(() => {
          if (!done) {
            timedOut = true
            try {
              child.kill('SIGKILL')
            } catch {}
          }
        }, opts.timeout)
      : null

    const finish = (code: number) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve({ code, output: out, timedOut })
    }

    child.on('error', (err: any) => {
      push(err?.message ?? String(err))
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

export function isAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

export function readPid(file: string): number | null {
  try {
    const n = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function readCmdline(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim()
  } catch {
    return ''
  }
}

/** 读 /proc/<pid>/stat 的第 4/5 字段：ppid、pgrp */
export function readStat(pid: number): { ppid: number; pgrp: number } | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    // comm 字段可能含空格/括号，取最后一个 ')' 之后再切
    const rest = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
    // rest[0]=state rest[1]=ppid rest[2]=pgrp
    return { ppid: Number(rest[1]), pgrp: Number(rest[2]) }
  } catch {
    return null
  }
}

function listPids(): number[] {
  try {
    return fs
      .readdirSync('/proc')
      .filter((n) => /^\d+$/.test(n))
      .map(Number)
  } catch {
    return []
  }
}

/** 收集某个进程的所有后代（含自身），按深度从深到浅排序 */
export function collectTree(rootPid: number): number[] {
  const children = new Map<number, number[]>()
  for (const pid of listPids()) {
    const st = readStat(pid)
    if (!st) continue
    const arr = children.get(st.ppid) ?? []
    arr.push(pid)
    children.set(st.ppid, arr)
  }

  const result: number[] = []
  const queue: Array<[number, number]> = [[rootPid, 0]]
  while (queue.length) {
    const [pid, depth] = queue.shift()!
    const st = readStat(pid)
    if (!st && pid !== rootPid) continue
    result.push(pid)
    for (const c of children.get(pid) ?? []) queue.push([c, depth + 1])
  }
  return result.reverse() // 先杀叶子，再杀父
}

/** 安全杀进程树（不使用进程组负号，避免误伤 Termux 会话） */
export function killTree(rootPid: number, signal: NodeJS.Signals = 'SIGTERM'): number[] {
  const killed: number[] = []
  for (const pid of collectTree(rootPid)) {
    if (pid === process.pid) continue
    try {
      process.kill(pid, signal)
      killed.push(pid)
    } catch {}
  }
  return killed
}

/** 端口是否有人在监听 */
export function isPortOpen(port: number, host = '127.0.0.1', timeout = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (v: boolean) => {
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 通过 /proc/net + /proc/<pid>/fd 找出监听某端口的进程 */
export function findPortOwners(port: number): number[] {
  const inodes = new Set<string>()
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').slice(1)
      for (const line of lines) {
        const cols = line.trim().split(/\s+/)
        if (cols.length < 10) continue
        const local = cols[1] // 0100007F:1F40
        const state = cols[3]
        if (state !== '0A') continue // LISTEN
        const portHex = local.split(':')[1]
        if (parseInt(portHex, 16) !== port) continue
        inodes.add(cols[9])
      }
    } catch {}
  }
  if (inodes.size === 0) return []

  const pids: number[] = []
  for (const pid of listPids()) {
    let fds: string[] = []
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`)
        const m = link.match(/^socket:\[(\d+)\]$/)
        if (m && inodes.has(m[1])) {
          pids.push(pid)
          break
        }
      } catch {}
    }
  }
  return pids
}

export function safeName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const n = name.trim()
  if (!n || n === '.' || n === '..') return null
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n)) return null
  if (n === '_panel' || n === 'exports' || n === 'node_modules') return null
  return n
}

export function readTail(file: string, bytes = 6000): string {
  try {
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - bytes)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return buf.toString()
  } catch {
    return ''
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function clip(text: string, max = 4000): string {
  if (!text) return ''
  const t = stripAnsi(text).trim()
  return t.length > max ? `…（已截断）\n${t.slice(-max)}` : t
}

/** 去掉终端颜色码（Vite 会把颜色码插进 URL 中间） */
export function stripAnsi(text: string): string {
  return String(text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

export function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 在 PATH 里找可执行文件 */
export function findInPath(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, cmd)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {}
  }
  return null
}

/** Termux 上是 python，部分 Linux 是 python3 */
export function pythonBin(): string {
  return findInPath('python') ?? findInPath('python3') ?? 'python'
}

