/**
 * 用无头 Edge + CDP 给 UI 截图（Electron GUI 在本环境跑不起来时的替代验证手段）。
 * 运行：node scripts/ui-shot.mjs [url] [outDir]
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2] || 'http://127.0.0.1:8899/preview.html'
const outDir = path.resolve(process.argv[3] || 'tmp/ui')
const port = 9333
const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findEdge() {
  for (const candidate of edgeCandidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  throw new Error('msedge.exe not found')
}

async function waitForTarget(deadlineMs = 20_000) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* not ready */
    }
    await sleep(300)
  }
  throw new Error('CDP target not ready')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: 30_000
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed')
    }
    return result.result?.value
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  const edge = await findEdge()
  const profile = path.join(os.tmpdir(), `aitutor-ui-${Date.now()}`)

  const child = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1360,900',
      url
    ],
    { stdio: 'ignore', detached: false }
  )

  const report = []
  try {
    const target = await waitForTarget()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    const cdp = new Cdp(ws)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1360,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })

    const shot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(outDir, `${name}.png`)
      await fs.writeFile(file, Buffer.from(data, 'base64'))
      report.push(`shot ${name}`)
    }

    const ready = await cdp.evaluate(
      `new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const rows = document.querySelectorAll('.doc-row').length;
          if (rows > 0 || Date.now() - started > 8000) { clearInterval(timer); resolve(rows); }
        }, 120);
      })`,
      true
    )
    report.push(`doc rows rendered: ${ready}`)
    await sleep(700)
    await shot('01-library')

    const opened = await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('.doc-actions button'));
      const target = buttons.find((b) => b.textContent && b.textContent.includes('查看讲解'));
      if (!target) return 'no-button';
      target.click();
      return 'clicked';
    })()`)
    report.push(`open lesson: ${opened}`)
    await sleep(1200)
    await shot('02-lesson')

    const scrolled = await cdp.evaluate(`(() => {
      const panel = document.querySelector('.content-panel');
      if (!panel) return 'no-panel';
      panel.scrollTop = 640;
      return panel.scrollTop;
    })()`)
    report.push(`lesson scrolled: ${scrolled}`)
    await sleep(500)
    await shot('03-lesson-scrolled')

    const settingsClicked = await cdp.evaluate(`(() => {
      const button = document.querySelector('.sidebar-foot .nav-item');
      if (!button) return 'no-button';
      button.click();
      return 'clicked';
    })()`)
    report.push(`open settings: ${settingsClicked}`)
    await sleep(900)
    await shot('04-settings')

    await cdp.evaluate('window.scrollTo(0, 0)')
    await sleep(200)
    await shot('05-settings2')

    ws.close()
  } finally {
    child.kill()
    await sleep(500)
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  console.log(report.join('\n'))
}

main().catch((error) => {
  console.error('UI SHOT FAILED:', error)
  process.exit(1)
})
