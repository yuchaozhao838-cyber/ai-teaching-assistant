/**
 * 抓取弹窗 UI 截图（用预览页面 + 无头 Edge）
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2] || 'http://127.0.0.1:8899/preview.html'
const outDir = path.resolve(process.argv[3] || 'tmp/ui-web')
const port = 9336
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = path.join(os.tmpdir(), `aitutor-web-${Date.now()}`)

const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1360,900', url
], { stdio: 'ignore' })

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
  async evaluate(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
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
    } catch { /* wait */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(2000)

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
    console.log('shot', name)
  }

  // 打开「网页抓取」弹窗
  console.log(await cdp.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('.import-card')).find((el) => el.textContent.includes('网页抓取'));
    if (!card) return 'no-card';
    card.click();
    return 'clicked';
  })()`))
  await sleep(900)
  await shot('01-web-direct')

  // 切到「需要登录」方式
  console.log(await cdp.evaluate(`(() => {
    const radios = Array.from(document.querySelectorAll('.n-radio-button'));
    const target = radios.find((el) => el.textContent.includes('需要登录'));
    if (!target) return 'no-radio:' + radios.length;
    target.click();
    return 'clicked';
  })()`))
  await sleep(900)
  await shot('02-web-login')
  ws.close()
}

main().catch((e) => { console.error('FAILED', e); process.exit(1) }).finally(() => {
  child.kill()
  setTimeout(() => fs.rm(profile, { recursive: true, force: true }).catch(() => {}), 400)
})
