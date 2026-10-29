/**
 * 练习页截图：打开预览页 → 切到「练习」→ 展开第一题答案 → 截图
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2]
const outDir = path.resolve(process.argv[3] || 'tmp/ui-practice')
const port = 9337
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = path.join(os.tmpdir(), `aitutor-practice-${Date.now()}`)

const child = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1360,900',
    url
  ],
  { stdio: 'ignore' }
)

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  let target = null
  for (let i = 0; i < 40 && !target; i += 1) {
    await sleep(300)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
    } catch {
      /* wait */
    }
  }
  if (!target) throw new Error('无法连接 Edge 调试端口')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(2200)

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
    console.log('shot', name)
  }

  console.log(
    await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.nav-item')).find((el) => el.textContent.includes('练习'));
      if (!item) return 'no-nav';
      item.click();
      return 'clicked';
    })()`)
  )
  await sleep(1200)
  await shot('01-practice')

  console.log(
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.problem-answer button')).find((el) => el.textContent.includes('看答案'));
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked';
    })()`)
  )
  await sleep(900)
  await shot('02-answer')
  ws.close()
}

main()
  .catch((e) => {
    console.error('FAILED', e)
    process.exit(1)
  })
  .finally(() => {
    child.kill()
    setTimeout(() => fs.rm(profile, { recursive: true, force: true }).catch(() => {}), 400)
  })
