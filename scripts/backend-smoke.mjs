/**
 * 主进程逻辑自测：用桩（stub）替换 electron 模块，在纯 Node 里跑通
 * 「导入 → 生成讲解（演示模型）→ 编辑 → 导出」整条后端链路。
 * 运行：node scripts/backend-smoke.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = path.join(root, 'tmp', 'backend')
const appData = path.join(work, 'appdata')
const outDir = path.join(work, 'out')
const dataDir = path.join(appData, 'AITutorAssistant')

const electronStub = `
const path = require('node:path')
const fs = require('node:fs')

const handlers = new Map()
const sent = []
const windows = []
let basePaths = {}

function makeWindow(options = {}) {
  const win = {
    options,
    destroyed: false,
    shown: false,
    webContents: {
      sent: [],
      send(channel, payload) { this.sent.push({ channel, payload }); sent.push({ channel, payload }) },
      on() {},
      once() {},
      setWindowOpenHandler() {},
      setUserAgent() {},
      async executeJavaScript() { return {} },
      async printToPDF() { return Buffer.from('%PDF-1.4 stub') },
      async capturePage() { return { toPNG: () => Buffer.from(''), getSize: () => ({ width: 0, height: 0 }) } }
    },
    on(event, cb) { if (event === 'ready-to-show') setTimeout(cb, 5) },
    once(event, cb) { if (event === 'ready-to-show') setTimeout(cb, 5) },
    show() { this.shown = true },
    loadFile() { return Promise.resolve() },
    loadURL() { return Promise.resolve() },
    isDestroyed() { return this.destroyed },
    isMinimized() { return false },
    restore() {},
    focus() {},
    destroy() { this.destroyed = true },
    close() { this.destroyed = true }
  }
  windows.push(win)
  return win
}

class BrowserWindow {
  constructor(options) { return makeWindow(options) }
  static getAllWindows() { return windows.filter((w) => !w.destroyed) }
  static fromWebContents(contents) { return windows.find((w) => w.webContents === contents) || windows[0] || null }
}

const app = {
  setPath(name, value) { basePaths[name] = value },
  getPath(name) {
    if (basePaths[name]) return basePaths[name]
    if (name === 'appData') return ${JSON.stringify(appData)}
    if (name === 'documents') return ${JSON.stringify(outDir)}
    if (name === 'temp') return ${JSON.stringify(path.join(work, 'temp'))}
    return ${JSON.stringify(appData)}
  },
  getVersion() { return '1.0.0' },
  getName() { return 'AI课堂助手' },
  setAppUserModelId() {},
  requestSingleInstanceLock() { return true },
  whenReady() { return Promise.resolve() },
  on() {},
  quit() {},
  exit() {},
  getAppPath() { return ${JSON.stringify(root)} }
}

module.exports = {
  app,
  BrowserWindow,
  ipcMain: {
    handle(channel, fn) { handlers.set(channel, fn) },
    on() {},
    removeHandler() {}
  },
  dialog: {
    async showOpenDialog() { return { canceled: true, filePaths: [] } },
    async showSaveDialog(_win, options) {
      const ext = (options.filters && options.filters[0] && options.filters[0].extensions[0]) || 'dat'
      const target = path.join(${JSON.stringify(outDir)}, 'export-' + Date.now() + '.' + ext)
      return { canceled: false, filePath: target }
    },
    async showMessageBox() { return { response: 0 } }
  },
  shell: { async openPath() {}, async openExternal() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate(t) { return t } },
  safeStorage: {
    isEncryptionAvailable() { return false },
    encryptString(v) { return Buffer.from(v, 'utf8') },
    decryptString(v) { return Buffer.from(v).toString('utf8') }
  },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { async fetch() { throw new Error('net.fetch not stubbed') } },
  nativeTheme: { shouldUseDarkColors: false },
  __test: { handlers, sent, windows, makeWindow }
}
`

async function main() {
  const report = []
  await fs.rm(work, { recursive: true, force: true })
  await fs.mkdir(path.join(work, 'node_modules', 'electron'), { recursive: true })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(
    path.join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '33.4.11', main: 'index.js' }, null, 2)
  )
  await fs.writeFile(path.join(work, 'node_modules', 'electron', 'index.js'), electronStub)
  await fs.copyFile(path.join(root, 'apps', 'desktop', 'out', 'main', 'index.js'), path.join(work, 'index.js'))

  const require = createRequire(path.join(work, 'index.js'))
  require('./index.js')
  const stub = require('electron')
  const { handlers, sent } = stub.__test

  const invoke = async (channel, ...args) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing handler: ${channel}`)
    const fakeWindow = stub.__test.windows[0] || stub.__test.makeWindow()
    return handler({ sender: fakeWindow.webContents }, ...args)
  }

  await new Promise((resolve) => setTimeout(resolve, 200))
  report.push(`registered handlers: ${handlers.size} → ${[...handlers.keys()].join(', ')}`)

  // 1. 设置
  let settings = await invoke('settings:get')
  report.push(`settings providers: ${settings.providers.map((p) => `${p.name}(${p.kind})`).join(', ')}; active=${settings.activeProviderId}`)

  const saved = await invoke('settings:saveProvider', {
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.6,
    apiKey: 'sk-test-123'
  })
  const deepseek = saved.providers.find((p) => p.name === 'DeepSeek')
  report.push(`saved provider: ${deepseek.id} hasKey=${deepseek.hasKey}`)
  const testResult = await invoke('settings:test', {
    id: deepseek.id,
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.6
  })
  report.push(`test without network: ok=${testResult.ok} message=${testResult.message.slice(0, 60)}`)
  const restored = await invoke('settings:setActive', 'demo')
  report.push(`active provider restored: ${restored.activeProviderId}`)

  // 2. 导入文本
  const text = `# 第二章 矩阵的秩
## 2.1 秩的定义
矩阵 $A$ 的行秩等于列秩，统称为矩阵的秩，记作 $\\\\mathrm{rank}(A)$。
若 $A$ 为 $m\\\\times n$ 矩阵，则 $0 \\\\le \\\\mathrm{rank}(A) \\\\le \\\\min(m,n)$。
## 2.2 秩与线性相关
矩阵的秩等于其极大线性无关组所含向量的个数。
若向量组线性相关，则存在不全为零的系数使其线性组合为零向量。
## 2.3 秩的求法
通过初等行变换把矩阵化为行阶梯形，非零行的个数就是秩。
注意：初等变换不改变秩。`

  const imported = await invoke('docs:importText', '第二章 矩阵的秩', text)
  report.push(`import text: ok=${imported.ok} doc=${imported.document?.id} blocks=${imported.document?.blocks.length}`)
  const documentId = imported.document.id

  const documents = await invoke('docs:list')
  report.push(`documents listed: ${documents.length}`)

  // 3. 生成（演示模型，不联网）
  const started = await invoke('lesson:generate', documentId)
  report.push(`generate started: ok=${started.ok} artifact=${started.artifactId}`)

  let artifact = null
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const artifacts = await invoke('lesson:list')
    const current = artifacts[0]
    if (current && current.status !== 'generating') {
      artifact = current
      break
    }
  }

  if (!artifact) {
    report.push('FAILED: artifact not produced')
  } else {
    report.push(
      `artifact: status=${artifact.status} sections=${artifact.outline.length} explanations=${artifact.explanations.length} keypoints=${artifact.keyPoints.length}`
    )
    report.push(`outline titles: ${artifact.outline.map((n) => n.title).join(' / ')}`)
    report.push(`events received: ${sent.length} types=${[...new Set(sent.map((s) => s.payload?.type))].join(',')}`)
  }

  // 4. 编辑小节
  const sectionId = artifact?.outline?.[0]?.id
  const updated = await invoke('lesson:updateSection', artifact.id, sectionId, '> 手动修改后的内容')
  const afterUpdate = await invoke('lesson:get', artifact.id)
  report.push(
    `update section: ok=${updated.ok} manual=${Boolean(afterUpdate.explanations.find((e) => e.sectionId === sectionId)?.manual)}`
  )

  // 5. 导出三种格式
  for (const format of ['docx', 'pptx', 'pdf', 'md']) {
    try {
      const result = await invoke('exporter:run', artifact.id, format)
      if (result.ok) {
        const stat = await fs.stat(result.path)
        report.push(`export ${format}: ok (${stat.size} bytes)`)
      } else {
        report.push(`export ${format}: FAILED ${result.error}`)
      }
    } catch (error) {
      report.push(`export ${format}: THREW ${error.message}`)
    }
  }

  // 6. 删除
  await invoke('docs:remove', documentId)
  const afterDelete = await invoke('docs:list')
  const afterDeleteArtifacts = await invoke('lesson:list')
  report.push(`after delete: documents=${afterDelete.length} artifacts=${afterDeleteArtifacts.length}`)

  const log = report.join('\n')
  await fs.writeFile(path.join(work, 'backend-smoke.txt'), log, 'utf8')
  console.log(log)
}

main().catch((error) => {
  console.error('BACKEND SMOKE FAILED:', error)
  process.exit(1)
})
