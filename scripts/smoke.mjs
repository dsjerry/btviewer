// 端到端冒烟测试（D1）：启动真实应用（打包后的构建产物）+ 本地 HTTP 服务，
// 通过 Chrome DevTools Protocol 驱动渲染层，验证「添加任务 → 真实下载 → 界面显示已完成」整条链路。
//
// 不引入任何新依赖：CDP 用 Node 内置的 fetch + WebSocket（Node 22+），应用侧用 electron 自身。
// 用法：npm run smoke（需先 npm run build）
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..')
const CHECK_TIMEOUT_MS = 90_000
const results = []
const check = (label, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function electronBinary() {
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
  const path = join(ROOT, 'node_modules', 'electron', 'dist', name)
  if (!existsSync(path)) throw new Error(`未找到 Electron 可执行文件：${path}`)
  return path
}

// 本地文件服务：支持 Range（aria2 会并发分片请求，不支持 Range 会被降级为单连接甚至失败）
function startFileServer() {
  return new Promise((resolveServer) => {
    const payload = Buffer.alloc(1024 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251
    const server = createServer((request, response) => {
      const range = request.headers.range
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        const start = match && match[1] ? Number(match[1]) : 0
        const end = match && match[2] ? Number(match[2]) : payload.length - 1
        response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${payload.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
        response.end(payload.subarray(start, end + 1))
        return
      }
      response.writeHead(200, { 'content-length': payload.length, 'accept-ranges': 'bytes' })
      response.end(payload)
    })
    server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port }))
  })
}

async function findPageTarget(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  return null
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  let nextId = 0
  const evaluate = (expression) => new Promise((resolveEval, rejectEval) => {
    const id = ++nextId
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', onMessage)
      if (message.error) { rejectEval(new Error(message.error.message)); return }
      if (message.result?.exceptionDetails) { rejectEval(new Error(message.result.exceptionDetails.text || '页面执行异常')); return }
      resolveEval(message.result?.result?.value)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  return { evaluate, close: () => socket.close() }
}

async function main() {
  const mainBundle = join(ROOT, 'release', 'app', 'main', 'main.js')
  const rendererIndex = join(ROOT, 'release', 'app', 'renderer', 'index.html')
  if (!check('构建产物存在（先跑 npm run build）', existsSync(mainBundle) && existsSync(rendererIndex), rendererIndex)) return

  const { server, port: filePort } = await startFileServer()
  const profile = mkdtempSync(join(tmpdir(), 'btviewer-smoke-'))
  const downloadDir = join(profile, 'downloads')
  mkdirSync(downloadDir, { recursive: true })
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ downloadDir, notifyOnComplete: false, postAction: 'none', language: 'zh', speedLimit: '0' }), 'utf8')

  const url = `http://127.0.0.1:${filePort}/smoke.bin`
  const debugPort = 30000 + Math.floor(Math.random() * 5000)
  // ELECTRON_RUN_AS_NODE 必须整个删掉（置空字符串仍会被 Electron 视为已设置，应用会以纯 Node 模式启动，不起窗口）
  const childEnv = { ...process.env, ELECTRON_RENDERER_URL: `file:///${rendererIndex.replace(/\\/g, '/')}` }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const logPath = join(profile, 'app.log')
  const logFd = openSync(logPath, 'w')
  const child = spawn(electronBinary(), ['.', '--hidden', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`], {
    cwd: ROOT,
    stdio: ['ignore', logFd, logFd],
    env: childEnv
  })

  const deadline = Date.now() + CHECK_TIMEOUT_MS
  let client = null
  try {
    const target = await findPageTarget(debugPort, deadline)
    if (!check('应用启动并暴露调试端口', !!target)) {
      // 启动失败时把应用日志带出来，便于定位（例如依赖缺失、配置错误）
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').slice(-6).join(' | ') : '（无输出）'
      check('应用启动日志', false, log)
      return
    }
    client = await connect(target.webSocketDebuggerUrl)

    const ready = await (async () => {
      while (Date.now() < deadline) {
        const ok = await client.evaluate(`!!document.querySelector('.app-shell') && !!window.electronAPI`).catch(() => false)
        if (ok) return true
        await sleep(500)
      }
      return false
    })()
    if (!check('渲染层加载完成且 IPC 可用', ready)) return

    // 1) 通过 preload API 真正入队一个直链任务（等价于界面点击「添加任务」走到的那条链路）
    const added = await client.evaluate(`window.electronAPI.addTask(${JSON.stringify(url)}).then((r) => JSON.stringify(r))`)
    const addResult = JSON.parse(added)
    check('添加直链任务成功', addResult.success === true, addResult.error || addResult.data?.name || '')

    // 2) 等真实下载完成（引擎状态里的 seeding = 下满）
    const finished = await (async () => {
      while (Date.now() < deadline) {
        const raw = await client.evaluate('window.electronAPI.getAllStatuses().then((list) => JSON.stringify(list.map((t) => t.status)))').catch(() => '[]')
        if (JSON.parse(raw).includes('seeding')) return true
        await sleep(1000)
      }
      return false
    })()
    check('任务真实下载完成（状态进入已完成）', finished)

    // 3) 文件确实落盘且体积正确
    const file = join(downloadDir, 'smoke.bin')
    const size = existsSync(file) ? (await import('node:fs')).statSync(file).size : 0
    check('下载文件落盘且大小正确', size === 1024 * 1024, `${size} 字节`)

    // 4) 界面确实渲染出该任务，并显示「已完成」
    //    注意：下满的任务会被归到「已完成」分组，所以要先切页再切分组
    await client.evaluate(`document.querySelectorAll('.nav-item')[2]?.click()`)
    await sleep(400)
    await client.evaluate(`document.querySelectorAll('.task-tabs button')[1]?.click()`)
    await sleep(400)
    const readText = "document.body.innerText || document.body.textContent || ''"
    const uiText = await (async () => {
      while (Date.now() < deadline) {
        const text = await client.evaluate(readText).catch(() => '')
        if (text.includes('smoke.bin')) return text
        await sleep(500)
      }
      return ''
    })()
    check('下载页显示该任务', uiText.includes('smoke.bin'))
    check('界面显示任务已完成', /已完成|Completed/.test(uiText))
  } catch (error) {
    check('冒烟测试执行', false, String(error))
  } finally {
    client?.close()
    try { child.kill() } catch { /* 已退出 */ }
    await sleep(2500)
    if (process.platform === 'win32') {
      // 主进程被强杀时可能留下 aria2 子进程，按命令行匹配临时 profile 清理
      const { execFileSync } = await import('node:child_process')
      try {
        const list = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='aria2c.exe'\" | Where-Object { $_.CommandLine -like '*btviewer-smoke-*' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' })
        for (const pid of list.split(/\s+/).filter(Boolean)) { try { process.kill(Number(pid)) } catch { /* 已退出 */ } }
      } catch { /* 查询失败不影响结论 */ }
    }
    server.close()
    // 先出结论再清理：清理失败（Windows 上进程刚退出时目录可能仍被占用）不能吞掉测试结果
    console.log(results.join('\n'))
    const failed = results.filter((line) => line.startsWith('FAIL')).length
    console.log(`\n冒烟结果：${results.length - failed}/${results.length} 通过${failed ? `（${failed} 项失败）` : ''}`)
    try { rmSync(profile, { recursive: true, force: true }) } catch { console.log(`（临时目录未能删除，可手动清理：${profile}）`) }
    process.exit(failed ? 1 : 0)
  }
}

void main()
