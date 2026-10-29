/**
 * 真实应用里验证「添加一题 → 保存」这条会走 practice:update 的路径
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] || 9333)
const outDir = path.resolve(process.argv[3] || 'tmp/ui-live')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = list.find((t) => t.type === 'page' && t.url.includes('app.asar'))
  if (!target) throw new Error('没找到应用页面')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await sleep(900)

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
    console.log('shot', name)
  }

  // 进练习页
  await cdp.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent.includes('练习'));
    if (el) el.click();
    return true;
  })()`)
  await sleep(1200)

  // 打开「添加一题」
  const opened = await cdp.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '添加一题');
    if (!btn) return false;
    btn.click();
    return true;
  })()`)
  console.log('open add modal:', opened)
  await sleep(900)
  if (!opened) {
    console.log('没有「添加一题」按钮，可能没有题集')
    ws.close()
    return
  }

  const values = {
    stem: '设 f(x)=x^2，求 f(2) 的值。',
    answer: '4',
    explanation: '第一步：把 x=2 代进去。第二步：f(2)=4。'
  }
  const fillResult = await cdp.evaluate(`(() => {
    const values = ${JSON.stringify(values)};
    const areas = Array.from(document.querySelectorAll('.n-modal textarea'));
    if (areas.length < 3) return 'textareas=' + areas.length;
    const setValue = (el, value) => {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(areas[0], values.stem);
    setValue(areas[areas.length - 2], values.answer);
    setValue(areas[areas.length - 1], values.explanation);
    return 'filled=' + areas.length;
  })()`)
  console.log('fill:', fillResult)
  await sleep(700)
  await shot('05-edit-filled')

  const saved = await cdp.evaluate(`(() => {
    const modal = document.querySelector('.n-modal');
    if (!modal) return 'no-modal';
    const btn = Array.from(modal.querySelectorAll('button')).find((x) => x.textContent.trim() === '添加');
    if (!btn) return 'no-add-btn';
    btn.click();
    return 'clicked';
  })()`)
  console.log('save click:', saved)
  await sleep(2500)
  await shot('06-saved')

  const summary = await cdp.evaluate(`(() => ({
    fatal: document.body.innerText.includes('界面脚本出错') || document.body.innerText.includes('界面渲染出错'),
    cards: document.querySelectorAll('.problem-card').length,
    modalOpen: Boolean(document.querySelector('.n-modal'))
  }))()`)
  console.log('summary:', JSON.stringify(summary))
  ws.close()
}

main().catch((e) => {
  console.error('FAILED', e.message)
  process.exit(1)
})
