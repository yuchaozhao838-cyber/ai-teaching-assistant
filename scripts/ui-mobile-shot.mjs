/**
 * 手机版（PWA）冒烟测试：用 Edge 手机视口打开，走一遍「粘贴文本 → 生成讲解 → 练习」
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2] || 'http://127.0.0.1:8899/index.html'
const outDir = path.resolve(process.argv[3] || 'tmp/ui-mobile')
const port = 9335
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = path.join(os.tmpdir(), `aitutor-mobile-${Date.now()}`)

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''))
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
  if (!target) throw new Error('连不上 Edge 调试端口')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // iPhone 14 视口
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await sleep(2500)

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
    console.log('shot', name)
  }

  console.log('tutor 就绪:', await cdp.evaluate(`Boolean(window.tutor)`))
  console.log('错误面板:', await cdp.evaluate(`document.body.innerText.includes('加载失败')`))
  await shot('01-library')

  // 打开「粘贴文本」
  console.log(
    '打开粘贴框:',
    await cdp.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.import-card')).find((el) => el.textContent.includes('粘贴文本'));
      if (!card) return 'no-card';
      card.click();
      return 'ok';
    })()`)
  )
  await sleep(800)

  // 填入一段材料并导入
  console.log(
    '导入文本:',
    await cdp.evaluate(`(() => {
      const inputs = Array.from(document.querySelectorAll('.n-modal input'));
      const areas = Array.from(document.querySelectorAll('.n-modal textarea'));
      const setValue = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      if (inputs[0]) setValue(inputs[0], '质点运动学小测');
      if (areas[0]) setValue(areas[0], '# 质点运动学\\n\\n质点：忽略形状和大小、只有质量的几何点。\\n\\n当物体间距离远大于物体本身线度时，可把物体看作质点。\\n\\n位移是从起点指向终点的矢量，路程是轨迹的长度。');
      return 'inputs=' + inputs.length + ' areas=' + areas.length;
    })()`)
  )
  await sleep(600)
  await shot('02-text-modal')

  console.log(
    '点导入:',
    await cdp.evaluate(`(() => {
      const modal = document.querySelector('.n-modal');
      if (!modal) return 'no-modal';
      const btn = Array.from(modal.querySelectorAll('button')).find((x) => x.textContent.includes('导入'));
      if (!btn) return 'no-btn:' + Array.from(modal.querySelectorAll('button')).map((b) => b.textContent.trim()).join('/');
      btn.click();
      return 'ok';
    })()`)
  )
  await sleep(2500)
  await shot('03-after-import')

  // 生成讲解
  console.log(
    '生成讲解:',
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('生成讲解')) || Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '生成');
      if (!btn) return 'no-btn';
      btn.click();
      return 'ok';
    })()`)
  )
  await sleep(6000)
  await shot('04-lesson')

  const state = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('.doc-card, .doc-row').length,
    lessonText: (document.querySelector('.content-panel') || document.body).innerText.slice(0, 120),
    fatal: document.body.innerText.includes('加载失败')
  }))()`)
  console.log('状态:', JSON.stringify(state))
  ws.close()
}

main()
  .catch((e) => {
    console.error('FAILED', e.message)
    process.exitCode = 1
  })
  .finally(() => {
    child.kill()
    setTimeout(() => fs.rm(profile, { recursive: true, force: true }).catch(() => {}), 400)
  })
