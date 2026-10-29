/**
 * 在真实应用里跑一遍「练习」流程（CDP 驱动）：
 * 打开练习 → 建空白题集 → 添加一题 → 填题干/答案/解析 → 保存 → 校验落盘
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''))
    return r.result?.value
  }
}

const shot = async (cdp, name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('shot', name)
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
  await sleep(800)

  console.log('error panel?', await cdp.evaluate(`Boolean(document.querySelector('.fatal, #fatal'))`))

  // 1. 进练习
  console.log(
    'nav:',
    await cdp.evaluate(`(() => {
      const el = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent.includes('练习'));
      if (!el) return 'no-nav';
      el.click();
      return 'ok';
    })()`)
  )
  await sleep(1200)
  await shot(cdp, '01-practice-empty')

  // 2. 建空白题集
  console.log(
    'create:',
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('空白题集'));
      if (!btn) return 'no-btn';
      btn.click();
      return 'ok';
    })()`)
  )
  await sleep(1500)
  await shot(cdp, '02-manual-set')

  // 3. 添加一题
  console.log(
    'add:',
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '添加一题');
      if (!btn) return 'no-btn';
      btn.click();
      return 'ok';
    })()`)
  )
  await sleep(900)

  // 4. 填题干 / 答案 / 解析（对 textarea 派发 input 事件，触发 Vue 的 v-model）
  console.log(
    'fill:',
    await cdp.evaluate(`(() => {
      const areas = Array.from(document.querySelectorAll('.n-modal textarea'));
      if (areas.length < 3) return 'only ' + areas.length + ' textareas';
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(areas[0], '设 $f(x)=x^2$，求 $f\\\\'(2)$ 的值。');
      setValue(areas[areas.length - 2], '$4$');
      setValue(areas[areas.length - 1], '第一步：$f\\\\'(x)=2x$。\\n\\n第二步：代入 $x=2$，得 $4$。');
      return 'filled ' + areas.length;
    })()`)
  )
  await sleep(600)
  await shot(cdp, '03-edit-modal')

  // 5. 保存
  console.log(
    'save:',
    await cdp.evaluate(`(() => {
      const modal = document.querySelector('.n-modal');
      if (!modal) return 'no-modal';
      const btn = Array.from(modal.querySelectorAll('button')).find((x) => x.textContent.trim() === '添加');
      if (!btn) return 'no-save-btn';
      btn.click();
      return 'ok';
    })()`)
  )
  await sleep(2000)
  await shot(cdp, '04-saved')

  // 6. 页面上是否还有错误面板
  const fatal = await cdp.evaluate(`document.body.innerText.includes('界面脚本出错') || document.body.innerText.includes('界面渲染出错')`)
  console.log('fatal after save:', fatal)
  const items = await cdp.evaluate(`document.querySelectorAll('.problem-card').length`)
  console.log('problem cards:', items)
  ws.close()
}

main().catch((e) => {
  console.error('FAILED', e.message)
  process.exit(1)
})
