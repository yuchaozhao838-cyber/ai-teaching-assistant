/**
 * 真实应用里跑一次「按材料出题」，检查题目是否贴着材料
 */
const port = Number(process.argv[2] || 9333)
const docKeyword = process.argv[3] || '质点'
const count = Number(process.argv[4] || 4)

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
  async evaluate(expression, timeout = 240000) {
    const timer = setTimeout(() => rejectTimeout(), timeout)
    const rejectTimeout = () => {}
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    clearTimeout(timer)
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

  const docs = await cdp.evaluate(`window.tutor.docs.list().then((list) => list.map((d) => ({ id: d.id, title: d.title })))`)
  console.log('材料列表:', docs.map((d) => d.title.slice(0, 24)).join(' | '))
  const chosen = docs.find((d) => d.title.includes(docKeyword)) || docs[0]
  console.log('选中:', chosen.title)

  const started = Date.now()
  const result = await cdp.evaluate(
    `window.tutor.practice.generate(${JSON.stringify({
      documentId: chosen.id,
      mode: 'create',
      count,
      difficulty: 'mixed',
      types: ['choice', 'calc']
    })}).then((r) => ({
      ok: r.ok,
      error: r.error || '',
      warnings: r.warnings || [],
      title: r.set ? r.set.title : '',
      items: r.set ? r.set.items.map((i) => ({ stem: i.stem, answer: i.answer, quote: i.sourceQuote || '', section: i.sectionTitle || '', type: i.type })) : []
    }))`
  )
  console.log('耗时:', Math.round((Date.now() - started) / 1000) + 's')
  console.log('ok:', result.ok, result.error || '')
  console.log('warnings:', (result.warnings || []).join(' / ') || '无')
  for (const [index, item] of (result.items || []).entries()) {
    console.log(`\n[${index + 1}] ${item.type} | 考点: ${item.section}`)
    console.log('   题干:', item.stem.replace(/\n/g, ' ').slice(0, 140))
    console.log('   答案:', String(item.answer).replace(/\n/g, ' ').slice(0, 80))
    console.log('   依据:', item.quote.replace(/\n/g, ' ').slice(0, 80))
  }
  ws.close()
}

main().catch((e) => {
  console.error('FAILED', e.message)
  process.exit(1)
})
