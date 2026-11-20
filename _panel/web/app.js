/* 项目管理器前端 —— 无构建，原生 JS */

const $ = (sel, el = document) => el.querySelector(sel)
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel))

const LS_TOKEN = 'panel_token'
let TOKEN = localStorage.getItem(LS_TOKEN) || ''
let STATE = { projects: [], backendPort: 8000, portOpen: false, portOwnerName: null, base: '' }
let currentLogES = null
let currentLog = { name: null, role: 'backend' }

/* ---------- token ---------- */
;(function initToken() {
  const q = new URLSearchParams(location.search)
  const fromUrl = q.get('token')
  if (fromUrl) {
    TOKEN = fromUrl.trim()
    localStorage.setItem(LS_TOKEN, TOKEN)
    q.delete('token')
    const search = q.toString()
    history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash)
  }
})()

/* ---------- 请求 ---------- */
async function api(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + TOKEN }
  let body
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.raw) {
    headers['Content-Type'] = 'application/octet-stream'
    body = opts.raw
  }
  const res = await fetch(path, { method: opts.method || 'GET', headers, body })
  if (res.status === 401) {
    showAuth('token 无效或已变更，请重新输入')
    throw new Error('unauthorized')
  }
  let data = {}
  try {
    data = await res.json()
  } catch {
    data = {}
  }
  if (!res.ok && !data.message) throw new Error(data.error || res.status + ' ' + res.statusText)
  return data
}

/* ---------- 通用 UI ---------- */
let toastTimer = null
function toast(msg, bad = false) {
  const el = $('#toast')
  el.textContent = msg
  el.className = 'toast' + (bad ? ' bad' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600)
}

function showLoading(text) {
  $('#loadingText').textContent = text || '执行中…'
  $('#loading').classList.remove('hidden')
}
function hideLoading() {
  $('#loading').classList.add('hidden')
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmtSize(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function fmtTime(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------- 弹层 ---------- */
function openModal(build) {
  const mask = $('#modalMask')
  const box = $('#modal')
  box.innerHTML = ''
  build(box)
  mask.classList.remove('hidden')
  return box
}
function closeModal() {
  $('#modalMask').classList.add('hidden')
  $('#modal').innerHTML = ''
}
$('#modalMask').addEventListener('click', (e) => {
  if (e.target === $('#modalMask')) closeModal()
})

/* ---------- 鉴权界面 ---------- */
function showAuth(msg) {
  $('#authScreen').classList.remove('hidden')
  $('#main').classList.add('hidden')
  if (msg) {
    $('#authErr').textContent = msg
    $('#authErr').classList.remove('hidden')
  }
}

$('#authBtn').addEventListener('click', async () => {
  const t = $('#authToken').value.trim()
  if (!t) return
  TOKEN = t
  localStorage.setItem(LS_TOKEN, TOKEN)
  try {
    await api('/api/projects')
    $('#authScreen').classList.add('hidden')
    $('#main').classList.remove('hidden')
    refresh()
  } catch (e) {
    $('#authErr').textContent = 'token 无效：' + e.message
    $('#authErr').classList.remove('hidden')
  }
})

/* ---------- 刷新 ---------- */
async function refresh() {
  try {
    const d = await api('/api/projects')
    STATE = d
    $('#basePath').textContent = d.base || ''
    $('#footInfo').textContent = `共 ${d.projects.length} 个项目 · 后端端口 ${d.backendPort}`
    renderPortBanner(d)
    renderProjects(d.projects)
  } catch (e) {
    if (e.message !== 'unauthorized') toast('刷新失败：' + e.message, true)
  }
}

function renderPortBanner(d) {
  const el = $('#portBanner')
  if (d.portOpen) {
    el.className = 'banner warn'
    el.innerHTML = d.portOwnerName
      ? `后端端口 ${d.backendPort} 正被「${esc(d.portOwnerName)}」占用。要启动别的项目，需先停止它，或点启动时选择强制接管。`
      : `后端端口 ${d.backendPort} 被未知进程占用（PID ${d.portOwners.join(', ') || '?'}）。可强制接管或手动处理。`
    el.classList.remove('hidden')
  } else {
    el.className = 'banner ok'
    el.textContent = `后端端口 ${d.backendPort} 空闲`
    el.classList.remove('hidden')
  }
}

function renderProjects(list) {
  const box = $('#projects')
  box.innerHTML = ''
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="muted">还没有项目。点上面「新建项目」创建一个，或「导入项目」恢复之前的打包。</div></div>`
    return
  }
  for (const p of list) box.appendChild(renderCard(p))
}

function renderCard(p) {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.name = p.name

  const fmtBack = p.backendRunning ? '运行中' : '已停止'
  const fmtFront = p.frontendRunning ? '运行中' : '已停止'

  card.innerHTML = `
    <div class="card-head">
      <div class="card-name">${esc(p.name)}</div>
      <div class="pills">
        <span class="pill ${p.backendRunning ? 'on' : 'off'}"><i class="dot ${p.backendRunning ? 'on' : ''}"></i>后端 ${fmtBack}</span>
        <span class="pill ${p.frontendRunning ? 'on' : 'off'}"><i class="dot ${p.frontendRunning ? 'on' : ''}"></i>前端 ${fmtFront}</span>
      </div>
    </div>
    <div class="card-links">
      ${p.frontendRunning && p.frontendUrl ? `<a href="${esc(p.frontendUrl)}" target="_blank" rel="noreferrer">${esc(p.frontendUrl)}</a>` : `<span class="none">前端地址：${p.frontendUrl ? esc(p.frontendUrl) : '未解析'}</span>`}
      ${p.hasDocs ? `<a href="${esc(p.backendUrl)}/docs" target="_blank" rel="noreferrer">接口文档</a>` : ''}
    </div>
    <div class="card-meta">
      <span class="tag">PID 后 ${p.backendPid ?? '—'} / 前 ${p.frontendPid ?? '—'}</span>
      <span class="tag">更新 ${fmtTime(p.updatedAt)}</span>
      ${p.hasVenv ? '' : '<span class="tag bad">缺 venv</span>'}
      ${p.hasNodeModules ? '' : '<span class="tag bad">缺 node_modules</span>'}
      ${p.backendStale || p.frontendStale ? '<span class="tag stale">PID 疑似失效</span>' : ''}
    </div>
    <div class="card-actions">
      <button class="primary" data-act="start" ${p.backendRunning && p.frontendRunning ? 'disabled' : ''}>启动</button>
      <button data-act="stop" ${!p.backendRunning && !p.frontendRunning ? 'disabled' : ''}>停止</button>
      <button data-act="restart">重启</button>
      <button data-act="logs">日志</button>
      <button data-act="export">导出</button>
      <button class="danger" data-act="delete">删除</button>
    </div>
  `

  $$('button[data-act]', card).forEach((btn) => {
    btn.addEventListener('click', () => onCardAction(p, btn.dataset.act, btn))
  })
  return card
}

function setCardBusy(name, busy) {
  const card = $('.card[data-name="' + cssEscape(name) + '"]')
  if (!card) return
  $$('button', card).forEach((b) => (b.disabled = busy))
}
function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&')
}

/* ---------- 卡片操作 ---------- */
async function onCardAction(p, act, btn) {
  if (act === 'logs') return openLogs(p.name)
  if (act === 'export') return doExport(p.name)
  if (act === 'delete') return confirmDelete(p.name)

  if (act === 'start') {
    setCardBusy(p.name, true)
    showLoading('正在启动 ' + p.name + ' …')
    try {
      const r = await api(`/api/projects/${encodeURIComponent(p.name)}/start`, { method: 'POST', json: {} })
      hideLoading()
      showResult('启动 ' + p.name, r, () => forceStart(p.name))
      afterChange(p.name, true)
    } catch (e) {
      hideLoading()
      toast(e.message, true)
    } finally {
      setCardBusy(p.name, false)
    }
    return
  }

  if (act === 'stop') {
    setCardBusy(p.name, true)
    showLoading('正在停止 ' + p.name + ' …')
    try {
      const r = await api(`/api/projects/${encodeURIComponent(p.name)}/stop`, { method: 'POST', json: {} })
      hideLoading()
      showResult('停止 ' + p.name, r)
      afterChange(p.name)
    } catch (e) {
      hideLoading()
      toast(e.message, true)
    } finally {
      setCardBusy(p.name, false)
    }
    return
  }

  if (act === 'restart') {
    setCardBusy(p.name, true)
    showLoading('正在重启 ' + p.name + ' …')
    try {
      const r = await api(`/api/projects/${encodeURIComponent(p.name)}/restart`, { method: 'POST', json: {} })
      hideLoading()
      showResult('重启 ' + p.name, r)
      afterChange(p.name, true)
    } catch (e) {
      hideLoading()
      toast(e.message, true)
    } finally {
      setCardBusy(p.name, false)
    }
  }
}

async function forceStart(name) {
  closeModal()
  showLoading('正在强制接管 8000 端口并启动…')
  try {
    const r = await api(`/api/projects/${encodeURIComponent(name)}/start`, { method: 'POST', json: { force: true } })
    hideLoading()
    showResult('强制启动 ' + name, r)
    afterChange(name, true)
  } catch (e) {
    hideLoading()
    toast(e.message, true)
  }
}

function afterChange(name, expectUrl = false) {
  refresh()
  setTimeout(refresh, 1500)
  if (expectUrl) setTimeout(refresh, 4000)
}

/* ---------- 结果弹层 ---------- */
function showResult(title, r, forceAction) {
  openModal((box) => {
    const steps = Array.isArray(r.steps) ? r.steps : []
    box.innerHTML = `
      <h2>${esc(title)}</h2>
      <p class="sub">${r.ok ? '执行成功' : '执行未完全成功'}</p>
      <div class="result-msg ${r.ok ? '' : 'bad'}">${esc(r.message || '')}</div>
      <div class="steps"></div>
      <div class="modal-actions"></div>
    `
    const stepsBox = $('.steps', box)
    for (const s of steps) {
      const item = document.createElement('div')
      item.className = 'step'
      item.innerHTML = `
        <div class="step-head">
          <span class="mark ${s.ok ? 'ok' : 'fail'}">${s.ok ? '✓' : '✕'}</span>
          <span>${esc(s.title)}</span>
        </div>
        ${s.output ? `<pre class="step-body">${esc(s.output)}</pre>` : ''}
      `
      stepsBox.appendChild(item)
    }
    const actions = $('.modal-actions', box)
    if (forceAction && /占用|端口/.test(r.message || '')) {
      const b = document.createElement('button')
      b.className = 'primary'
      b.textContent = '强制接管并启动'
      b.onclick = forceAction
      actions.appendChild(b)
    }
    const close = document.createElement('button')
    close.className = 'ghost'
    close.textContent = '关闭'
    close.onclick = closeModal
    actions.appendChild(close)
  })
}

/* ---------- 新建 ---------- */
$('#btnCreate').addEventListener('click', () => {
  openModal((box) => {
    box.innerHTML = `
      <h2>新建项目</h2>
      <p class="sub">自动创建 backend（venv + Python 依赖）与 frontend（Vue3 + Vite）并安装依赖。Starlette 约 1 分钟；FastAPI 需现编译 pydantic-core，可能很久。</p>
      <div class="field">
        <label>项目名（字母开头，可用数字 / - / _）</label>
        <input id="newName" placeholder="例如 my-app" autocomplete="off" spellcheck="false">
      </div>
      <div class="field">
        <label>后端框架</label>
        <div class="seg" id="beSeg">
          <button type="button" class="seg-btn active" data-be="starlette">Starlette<em>纯 Python·秒装</em></button>
          <button type="button" class="seg-btn" data-be="fastapi">FastAPI<em>需编译 Rust</em></button>
        </div>
        <p class="hint" id="beHint"></p>
      </div>
      <div class="field">
        <label>前端脚手架选项</label>
        <div class="opts">
          <label class="opt"><input type="checkbox" id="optTs"><span>TypeScript</span></label>
          <label class="opt"><input type="checkbox" id="optRouter"><span>Vue Router</span></label>
          <label class="opt"><input type="checkbox" id="optPinia"><span>Pinia</span></label>
          <label class="opt"><input type="checkbox" id="optEslint"><span>ESLint</span></label>
          <label class="opt"><input type="checkbox" id="optDemo" checked><span>示例页（含后端连通测试）</span></label>
        </div>
        <p class="hint" id="optHint"></p>
      </div>
      <div class="field">
        <details class="preview">
          <summary>预览生成的文件 <span id="pvCount" class="muted"></span></summary>
          <div id="pvList" class="pv-list"><div class="muted">加载中…</div></div>
        </details>
      </div>
      <div class="checkline">
        <input type="checkbox" id="newStart" checked>
        <label for="newStart">创建完成后立即启动</label>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="mCancel">取消</button>
        <button class="primary" id="mOk">创建</button>
      </div>
    `
    const nameInput = $('#newName', box)
    const pvList = $('#pvList', box)
    const pvCount = $('#pvCount', box)
    let pvTimer = null
    let touched = false
    let backend = 'starlette'

    function currentOpts() {
      return {
        typescript: $('#optTs', box).checked,
        router: $('#optRouter', box).checked,
        pinia: $('#optPinia', box).checked,
        eslint: $('#optEslint', box).checked,
        demo: $('#optDemo', box).checked,
        backend,
      }
    }

    function setBackend(kind) {
      backend = kind === 'fastapi' ? 'fastapi' : 'starlette'
      $$('.seg-btn', box).forEach((b) => b.classList.toggle('active', b.dataset.be === backend))
      $('#beHint', box).textContent =
        backend === 'fastapi'
          ? 'FastAPI 依赖 pydantic-core，Termux 上要现场编译 Rust，可能十几分钟、还容易被系统杀进程'
          : 'Starlette 是纯 Python 包，几秒装完；路由/接口用法和 FastAPI 几乎一样'
    }

    function updateHint() {
      const o = currentOpts()
      const notes = []
      if (o.typescript) notes.push('入口改为 main.ts / vite.config.ts')
      if (o.router) notes.push('页面移入 src/views/HomeView.vue')
      if (o.pinia) notes.push('生成 src/stores/counter')
      if (o.eslint) notes.push('多装 eslint 依赖，首次安装更慢')
      $('#optHint', box).textContent = notes.length
        ? notes.join('；')
        : '默认最小模板：单页 App.vue，不装额外依赖'
    }

    async function loadPreview() {
      const o = currentOpts()
      const q = new URLSearchParams({ name: nameInput.value.trim() || 'my-app', ...o })
      try {
        const d = await api('/api/create/preview?' + q.toString())
        const files = d.files || []
        pvCount.textContent = `${files.length} 个文件`
        pvList.innerHTML = files
          .map(
            (f) => `<details class="pv"><summary><code>${esc(f.path)}</code></summary><pre>${esc(
              f.content.length > 3000
                ? f.content.slice(0, 3000) + `\n…（共 ${f.content.length} 字符）`
                : f.content
            )}</pre></details>`
          )
          .join('')
      } catch (e) {
        pvList.innerHTML = `<div class="muted">预览失败：${esc(e.message)}</div>`
      }
    }

    function schedulePreview() {
      updateHint()
      clearTimeout(pvTimer)
      pvTimer = setTimeout(loadPreview, 250)
    }

    setBackend('starlette')

    $$('.seg-btn', box).forEach((b) => {
      b.onclick = () => {
        touched = true
        setBackend(b.dataset.be)
        schedulePreview()
      }
    })

    ;['optTs', 'optRouter', 'optPinia', 'optEslint', 'optDemo'].forEach((id) => {
      $('#' + id, box).onchange = () => {
        touched = true
        schedulePreview()
      }
    })
    nameInput.oninput = schedulePreview

    // 读上次的选项作为默认值
    api('/api/create/options')
      .then((d) => {
        if (touched) return // 用户已经改过，别覆盖
        const o = d.options || {}
        $('#optTs', box).checked = !!o.typescript
        $('#optRouter', box).checked = !!o.router
        $('#optPinia', box).checked = !!o.pinia
        $('#optEslint', box).checked = !!o.eslint
        $('#optDemo', box).checked = o.demo !== false
        setBackend(o.backend)
        schedulePreview()
      })
      .catch(schedulePreview)

    $('#mCancel', box).onclick = closeModal
    $('#mOk', box).onclick = async () => {
      const name = $('#newName', box).value.trim()
      const start = $('#newStart', box).checked
      const options = currentOpts()
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
        toast('项目名不合法：字母开头，只能含字母/数字/-/_', true)
        return
      }
      closeModal()
      showLoading(`正在创建 ${name}（安装依赖可能较慢）…`)
      try {
        const r = await api('/api/projects', { method: 'POST', json: { name, start, options } })
        hideLoading()
        showResult('新建项目 ' + name, r)
        afterChange(name, true)
      } catch (e) {
        hideLoading()
        toast('创建失败：' + e.message, true)
      }
    }
    setTimeout(() => $('#newName', box).focus(), 100)
  })
})

/* ---------- 导入 ---------- */
$('#btnImport').addEventListener('click', () => {
  openModal((box) => {
    box.innerHTML = `
      <h2>导入项目</h2>
      <p class="sub">从 .tar.gz 恢复项目，并自动重建 venv / node_modules。目标目录已存在时会拒绝导入。</p>
      <div class="field">
        <label>方式一：从手机选择压缩包上传</label>
        <div class="file-row">
          <label class="file-btn" for="impFile">选择文件</label>
          <input type="file" id="impFile" class="hidden-file" accept=".gz,.tgz,application/gzip">
          <span id="impFileName" class="muted">未选择文件</span>
        </div>
      </div>
      <div class="field">
        <label>方式二：使用 exports/ 里已有的打包</label>
        <div id="impList" class="exp-list"><div class="muted">加载中…</div></div>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="mCancel">取消</button>
        <button class="primary" id="mUpload" disabled>上传并导入</button>
      </div>
    `
    const fileInput = $('#impFile', box)
    const upBtn = $('#mUpload', box)
    let chosenArchive = null

    fileInput.onchange = () => {
      const f = fileInput.files[0]
      upBtn.disabled = !f
      $('#impFileName', box).textContent = f ? `${f.name} · ${fmtSize(f.size)}` : '未选择文件'
      chosenArchive = null
      $$('.exp-row', box).forEach((r) => r.classList.remove('selected'))
    }

    async function loadExports() {
      try {
        const d = await api('/api/exports')
        const list = $('#impList', box)
        list.innerHTML = ''
        if (!d.exports.length) {
          list.innerHTML = '<div class="muted">exports/ 里还没有打包文件</div>'
          return
        }
        for (const ex of d.exports) {
          const row = document.createElement('div')
          row.className = 'exp-row'
          row.innerHTML = `
            <div class="exp-main">
              <div class="exp-name">${esc(ex.file)}</div>
              <div class="exp-sub">${fmtSize(ex.size)} · ${fmtTime(ex.time)}</div>
            </div>
            <div class="exp-btns"><button class="small primary">导入这个</button></div>
          `
          $('button', row).onclick = async () => {
            fileInput.value = ''
            upBtn.disabled = true
            closeModal()
            showLoading('正在导入 ' + ex.file + ' …')
            try {
              const r = await api('/api/import/archive', { method: 'POST', json: { file: ex.file } })
              hideLoading()
              showResult('导入 ' + (r.project ? r.project.name : ex.file), r)
              afterChange()
            } catch (e) {
              hideLoading()
              toast('导入失败：' + e.message, true)
            }
          }
          list.appendChild(row)
        }
      } catch (e) {
        $('#impList', box).innerHTML = `<div class="muted">读取失败：${esc(e.message)}</div>`
      }
    }
    loadExports()

    $('#mCancel', box).onclick = closeModal
    upBtn.onclick = async () => {
      const f = fileInput.files[0]
      if (!f) return
      closeModal()
      showLoading(`正在上传 ${f.name}（${fmtSize(f.size)}）…`)
      try {
        const r = await api('/api/import/upload?filename=' + encodeURIComponent(f.name), { method: 'POST', raw: f })
        hideLoading()
        showResult('导入 ' + f.name, r)
        afterChange()
      } catch (e) {
        hideLoading()
        toast('导入失败：' + e.message, true)
      }
    }
  })
})

/* ---------- 打包记录 ---------- */
$('#btnExports').addEventListener('click', showExportsModal)

async function showExportsModal() {
  openModal(async (box) => {
    box.innerHTML = `<h2>打包记录</h2><p class="sub">exports/ 下的 .tar.gz</p><div class="exp-list" id="expBox"><div class="muted">加载中…</div></div>
      <div class="modal-actions"><button class="ghost" id="mClose">关闭</button></div>`
    $('#mClose', box).onclick = closeModal
    try {
      const d = await api('/api/exports')
      const list = $('#expBox', box)
      list.innerHTML = ''
      if (!d.exports.length) {
        list.innerHTML = '<div class="muted">还没有打包文件。在项目卡片点「导出」生成。</div>'
        return
      }
      for (const ex of d.exports) {
        const row = document.createElement('div')
        row.className = 'exp-row'
        row.innerHTML = `
          <div class="exp-main">
            <div class="exp-name">${esc(ex.file)}</div>
            <div class="exp-sub">${fmtSize(ex.size)} · ${fmtTime(ex.time)}</div>
          </div>
          <div class="exp-btns">
            <a class="small ghost" style="text-decoration:none;padding:7px 10px;border-radius:8px;border:1px solid var(--line)" href="/api/exports/download/${encodeURIComponent(ex.file)}?token=${encodeURIComponent(TOKEN)}">下载</a>
            <button class="small danger">删除</button>
          </div>
        `
        $('button', row).onclick = async () => {
          if (!confirm('删除打包文件 ' + ex.file + ' ?')) return
          try {
            const r = await api('/api/exports/' + encodeURIComponent(ex.file), { method: 'DELETE' })
            toast(r.message || '已删除')
            showExportsModal()
          } catch (e) {
            toast('删除失败：' + e.message, true)
          }
        }
        list.appendChild(row)
      }
    } catch (e) {
      $('#expBox', box).innerHTML = `<div class="muted">读取失败：${esc(e.message)}</div>`
    }
  })
}

/* ---------- 导出 ---------- */
async function doExport(name) {
  showLoading('正在打包 ' + name + ' …')
  try {
    const r = await api(`/api/projects/${encodeURIComponent(name)}/export`, { method: 'POST', json: {} })
    hideLoading()
    showResult('导出 ' + name, r)
  } catch (e) {
    hideLoading()
    toast('导出失败：' + e.message, true)
  }
}

/* ---------- 删除 ---------- */
function confirmDelete(name) {
  openModal((box) => {
    box.innerHTML = `
      <h2>删除项目</h2>
      <p class="sub">会先停止服务，然后整个目录（代码 + venv + node_modules + 日志）一并删除，不可恢复。</p>
      <div class="field">
        <label>输入项目名确认：<b>${esc(name)}</b></label>
        <input id="delName" placeholder="${esc(name)}" autocomplete="off" spellcheck="false">
      </div>
      <div class="modal-actions">
        <button class="ghost" id="mCancel">取消</button>
        <button class="danger" id="mOk" disabled>删除</button>
      </div>
    `
    const input = $('#delName', box)
    const ok = $('#mOk', box)
    input.oninput = () => {
      ok.disabled = input.value.trim() !== name
    }
    $('#mCancel', box).onclick = closeModal
    ok.onclick = async () => {
      closeModal()
      showLoading('正在删除 ' + name + ' …')
      try {
        const r = await api(`/api/projects/${encodeURIComponent(name)}/delete`, { method: 'POST', json: { confirm: name } })
        hideLoading()
        showResult('删除 ' + name, r)
        refresh()
      } catch (e) {
        hideLoading()
        toast('删除失败：' + e.message, true)
      }
    }
  })
}

/* ---------- 日志 ---------- */
function openLogs(name, role = 'backend') {
  currentLog = { name, role }
  $('#logTitle').textContent = name + ' 日志'
  $('#logDrawer').classList.remove('hidden')
  $$('.drawer-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.role === role))
  connectLog(name, role)
}

function connectLog(name, role) {
  if (currentLogES) {
    currentLogES.close()
    currentLogES = null
  }
  const body = $('#logBody')
  body.textContent = '正在连接…'
  body.dataset.first = '1'
  const url = `/api/logs/${encodeURIComponent(name)}/${role}?token=${encodeURIComponent(TOKEN)}`
  const es = new EventSource(url)
  currentLogES = es
  es.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data)
      if (body.dataset.first === '1') {
        body.textContent = ''
        body.dataset.first = '0'
      }
      if (d.type === 'append') body.textContent += d.text
      if (d.type === 'error') body.textContent += '\n[错误] ' + d.text
      body.scrollTop = body.scrollHeight
    } catch {}
  }
  es.onerror = () => {
    if (body.dataset.first === '1') {
      body.textContent = ''
      body.dataset.first = '0'
    }
    body.textContent += '\n[连接断开]'
  }
}

$$('.drawer-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const role = btn.dataset.role
    $$('.drawer-tabs button').forEach((b) => b.classList.toggle('active', b === btn))
    if (currentLog.name) connectLog(currentLog.name, role)
  })
})

$('#logClose').addEventListener('click', () => {
  $('#logDrawer').classList.add('hidden')
  if (currentLogES) {
    currentLogES.close()
    currentLogES = null
  }
})
$('#logClear').addEventListener('click', () => {
  $('#logBody').textContent = ''
})

/* ---------- 环境 ---------- */
$('#btnEnv').addEventListener('click', () => {
  openModal(async (box) => {
    box.innerHTML = `<h2>环境检测</h2><p class="sub">依赖版本 / 磁盘 / 端口状态</p><div class="env-grid" id="envBox"><div class="muted">检测中…</div></div>
      <div class="modal-actions"><button class="ghost" id="mPanelLog">面板日志</button><button class="ghost" id="mClose">关闭</button></div>`
    $('#mClose', box).onclick = closeModal
    $('#mPanelLog', box).onclick = () => {
      closeModal()
      $('#logTitle').textContent = '面板日志'
      $('#logDrawer').classList.remove('hidden')
      $$('.drawer-tabs button').forEach((b) => (b.style.display = 'none'))
      if (currentLogES) currentLogES.close()
      const body = $('#logBody')
      body.textContent = ''
      const es = new EventSource('/api/panel/log?token=' + encodeURIComponent(TOKEN))
      currentLogES = es
      currentLog = { name: null, role: 'panel' }
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          if (d.type === 'append') body.textContent += d.text
          body.scrollTop = body.scrollHeight
        } catch {}
      }
    }
    try {
      const e = await api('/api/env')
      const rows = [
        ['工作区', e.base],
        ['Python', e.python],
        ['Node', e.node],
        ['npm', e.npm],
        ['磁盘可用', e.diskFreeMB + ' MB'],
        ['项目数', String(e.projects)],
        ['打包文件', String(e.exports)],
        ['后端端口', `${e.backendPort} ${e.portOpen ? '占用中（PID ' + (e.portOwners.join(',') || '?') + '）' : '空闲'}`],
        ['Termux', e.termux ? '是' : '否'],
      ]
      $('#envBox', box).innerHTML = rows
        .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
        .join('')
    } catch (err) {
      $('#envBox', box).innerHTML = `<div class="muted">检测失败：${esc(err.message)}</div>`
    }
  })
})

/* ---------- 刷新按钮 / 轮询 ---------- */
$('#btnRefresh').addEventListener('click', async () => {
  await refresh()
  toast('已刷新')
})

setInterval(() => {
  if (document.hidden) return
  if (!$('#modalMask').classList.contains('hidden')) return
  if (!$('#loading').classList.contains('hidden')) return
  refresh()
}, 5000)

/* ---------- 启动 ---------- */
;(async function boot() {
  if (!TOKEN) return showAuth()
  try {
    await api('/api/projects')
    $('#authScreen').classList.add('hidden')
    $('#main').classList.remove('hidden')
    refresh()
  } catch {
    /* showAuth 已在 api 内调用 */
  }
})()
