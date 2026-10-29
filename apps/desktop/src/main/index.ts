import { BrowserWindow, Menu, app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLocalResourceService } from '@tutor/resource-service'
import type { ResourceService } from '@tutor/resource-service'
import { registerIpcHandlers } from './ipc'
import { createSecretStore } from './secrets'
import { runSmoke, smokeEnabled } from './smoke'
import { renderPdfPages } from './pdf-render'

// 固定成 ASCII 的 userData 目录，避免中文路径在处理导出/临时文件时踩坑
app.setPath('userData', path.join(app.getPath('appData'), 'AITutorAssistant'))
app.setAppUserModelId('com.aitutor.classroom')

/* ------------------------- 启动诊断日志 ------------------------- */
// 万一启动/渲染阶段出问题，用户能看到窗口里的错误，我们也能拿到 startup.log
const logFile = path.join(app.getPath('userData'), 'startup.log')

function logStartup(message: string) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* 日志失败不能影响启动 */
  }
}

logStartup(`--- start electron=${process.versions.electron} chrome=${process.versions.chrome} argv=${process.argv.slice(1).join(' ')}`)
process.on('uncaughtException', (error) => logStartup(`uncaughtException: ${error?.stack ?? error}`))
process.on('unhandledRejection', (reason) => logStartup(`unhandledRejection: ${String(reason)}`))
app.on('child-process-gone', (_event, details) => logStartup(`child-process-gone: ${JSON.stringify(details)}`))
app.on('render-process-gone', (_event, _contents, details) => logStartup(`render-process-gone: ${JSON.stringify(details)}`))

// 桌面端以文本排版为主，关掉硬件加速能规避大量显卡驱动/叠加层导致的启动崩溃
try {
  app.disableHardwareAcceleration()
  logStartup('hardware acceleration disabled')
} catch (error) {
  logStartup(`disableHardwareAcceleration failed: ${String(error)}`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logStartup('another instance is already running, quitting')
  app.quit()
} else {
  const dataDir = path.join(app.getPath('userData'), 'data')

  let mainWindow: BrowserWindow | null = null

  function buildMenu() {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' }
        ]
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '打开数据目录',
            click: () => {
              void shell.openPath(dataDir)
            }
          },
          {
            label: '打开启动日志',
            click: () => {
              void shell.openPath(logFile)
            }
          },
          {
            label: '关于 AI 课堂助手',
            click: () => {
              void dialog.showMessageBox({
                type: 'info',
                title: '关于',
                message: `AI 课堂助手 v${app.getVersion()}`,
                detail: `讲解闭环 MVP：导入材料 → AI 生成知识点详解与重点划分 → 展示 / 导出。\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n数据目录：${dataDir}`,
                buttons: ['好']
              })
            }
          }
        ]
      }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  /** 渲染层加载失败时，用一张本地错误页把原因显示出来（而不是白屏/无窗口） */
  function showLoadError(win: BrowserWindow, detail: string) {
    logStartup(`renderer load failed: ${detail}`)
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AI 课堂助手 · 启动失败</title>
      <style>
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
          font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;background:#f4f6fb;color:#1c2a3a}
        .card{max-width:640px;padding:32px 36px;background:#fff;border:1px solid #e8edf5;border-radius:16px;
          box-shadow:0 8px 30px rgba(16,28,51,.08)}
        h1{font-size:18px;margin:0 0 12px} p{font-size:13px;line-height:1.9;color:#67788c;margin:0 0 10px}
        code{background:#f4f6fb;padding:2px 6px;border-radius:5px;font-size:12px;word-break:break-all}
        button{margin-top:14px;padding:8px 18px;border:none;border-radius:9px;background:#3355d1;color:#fff;
          font-size:13px;cursor:pointer}
      </style></head><body><div class="card">
      <h1>界面没能加载出来</h1>
      <p>请把下面的信息截图发我，我会尽快定位：</p>
      <p><code>${detail.replace(/[<>&]/g, ' ')}</code></p>
      <p>启动日志：<code>${logFile.replace(/[<>&]/g, ' ')}</code></p>
      <button onclick="location.reload()">重新加载</button>
      </div></body></html>`
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  }

  function createWindow(resources?: ResourceService) {
    logStartup('creating window')
    const win = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 1080,
      minHeight: 700,
      show: true,
      backgroundColor: '#f4f6fb',
      title: 'AI 课堂助手',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        webSecurity: true
      }
    })

    win.once('ready-to-show', () => {
      logStartup('ready-to-show')
      if (!win.isVisible()) win.show()
    })
    win.on('closed', () => {
      logStartup('window closed')
      mainWindow = null
    })

    win.webContents.on('did-finish-load', () => logStartup('did-finish-load'))
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      showLoadError(win, `did-fail-load ${code} ${description} ${url}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      showLoadError(win, `render-process-gone ${JSON.stringify(details)}`)
    })
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) logStartup(`renderer console(${level}): ${message}`)
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      const devUrl = process.env.VITE_DEV_SERVER_URL
      if (devUrl && url.startsWith(devUrl)) return
      if (url.startsWith('file://') || url.startsWith('data:')) return
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    })

    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl) {
      logStartup(`loading dev url ${devUrl}`)
      win.loadURL(devUrl).catch((error) => showLoadError(win, `loadURL failed: ${String(error)}`))
    } else {
      const indexFile = path.join(__dirname, '../renderer/index.html')
      logStartup(`loading renderer ${indexFile} exists=${fs.existsSync(indexFile)}`)
      win
        .loadFile(indexFile)
        .then(() => logStartup('renderer loadFile resolved'))
        .catch((error) => showLoadError(win, `loadFile failed: ${String(error)} (${pathToFileURL(indexFile).href})`))
    }

    mainWindow = win

    if (resources && smokeEnabled()) {
      win.once('ready-to-show', () => {
        void runSmoke(win, resources).finally(() => {
          setTimeout(() => app.quit(), 400)
        })
      })
    }

    return win
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    logStartup('app ready')
    const secrets = createSecretStore(path.join(app.getPath('userData'), 'secrets.json'))
    const resources = createLocalResourceService({ dataDir, secrets })
    registerIpcHandlers({ resources, secrets, dataDir })
    logStartup('ipc handlers registered')
    buildMenu()
    createWindow(resources)

    // 自检：AITUTOR_SELFTEST_PDF=<pdf 路径> 时验证「PDF 逐页渲染」在打包环境（asar）里能否工作
    const selftestPdf = process.env.AITUTOR_SELFTEST_PDF
    if (selftestPdf) {
      void (async () => {
        try {
          const started = Date.now()
          const result = await renderPdfPages(selftestPdf, { maxPages: 2, width: 900 })
          logStartup(
            `selftest renderPdfPages: pages=${result.pages.length} total=${result.total} ` +
              `firstLen=${result.pages[0]?.length ?? 0} ms=${Date.now() - started}`
          )
        } catch (error) {
          logStartup(`selftest renderPdfPages FAILED: ${(error as Error)?.message ?? String(error)}`)
        }
      })()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(resources)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
