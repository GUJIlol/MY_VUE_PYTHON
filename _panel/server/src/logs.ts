import fs from 'node:fs'
import type { Response } from 'express'
import { stripAnsi } from './utils.js'

/** SSE 流式输出日志文件：先补末尾 4000 字节，之后每 800ms 增量推送 */
export function streamLog(res: Response, logPath: string) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  if (!fs.existsSync(logPath)) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: '日志文件不存在' })}\n\n`)
    res.end()
    return
  }

  let offset = 0
  const send = (text: string) => {
    res.write(`data: ${JSON.stringify({ type: 'append', text: stripAnsi(text) })}\n\n`)
  }

  try {
    const stat = fs.statSync(logPath)
    const start = Math.max(0, stat.size - 4000)
    const len = stat.size - start
    if (len > 0) {
      const fd = fs.openSync(logPath, 'r')
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, start)
      fs.closeSync(fd)
      send(buf.toString())
    }
    offset = stat.size
  } catch {}

  const timer = setInterval(() => {
    try {
      const stat = fs.statSync(logPath)
      if (stat.size < offset) offset = 0
      if (stat.size === offset) return
      const len = stat.size - offset
      const fd = fs.openSync(logPath, 'r')
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, offset)
      fs.closeSync(fd)
      offset = stat.size
      send(buf.toString())
    } catch {}
  }, 800)

  res.on('close', () => clearInterval(timer))
}

/** 心跳，避免长时间无输出被中间层断开（可选） */
export function heartbeat(res: Response): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {}
  }, 15000)
  return timer
}
