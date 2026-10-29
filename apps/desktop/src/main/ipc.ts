import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  Block,
  DocumentRecord,
  ExportFormat,
  LessonArtifact,
  LessonEvent,
  ProblemSet,
  ProviderConfig,
  ProviderUpdate,
  TestResult
} from '@tutor/shared'
import { AIError, createAIClient, isCanceled, testConnection } from '@tutor/ai-core'
import {
  FILE_FILTERS,
  createDocument,
  excerptForSection,
  ingestFromBlocks,
  ingestFromFile,
  ingestFromText,
  newId,
  textToBlocks
} from '@tutor/content-ingest'
import {
  PROMPT_VERSION,
  buildPdfPageMessages,
  buildSectionMessages,
  generateLesson,
  generateMockLesson,
  pagesToMarkdown
} from '@tutor/pedagogy'
import type { LessonCallbacks } from '@tutor/pedagogy'
import { exportDocx, exportMarkdown, exportPdf, exportPptx } from '@tutor/export'
import type { ResourceService, SecretStore } from '@tutor/resource-service'
import { fetchWebArticle, captureCurrentPage, captureState, closeCaptureWindow, downloadWithCaptureSession, openCaptureWindow } from './web-fetch'
import type { WebArticle } from './web-fetch'
import { printHtmlToPdf } from './pdf'
import { renderPdfPages } from './pdf-render'
import { encryptionAvailable } from './secrets'
import { buildMaterialContext, generateProblems } from '@tutor/practice'

export interface IpcContext {
  resources: ResourceService
  secrets: SecretStore
  dataDir: string
}

let currentJob: { artifactId: string; controller: AbortController } | null = null

function broadcast(event: LessonEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('lesson:event', event)
  }
}

function activeProvider(settings: AppSettings): ProviderConfig | undefined {
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0]
}

function sanitizeFileName(name: string): string {
  return (name || '讲解').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function errorMessage(error: unknown): string {
  if (error instanceof AIError) return error.friendly
  return (error as Error)?.message || String(error)
}

export function registerIpcHandlers(ctx: IpcContext) {
  const { resources, secrets, dataDir } = ctx

  /* ------------------------------- 基础信息 ------------------------------- */
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    encryptionAvailable: encryptionAvailable()
  }))

  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(dataDir)
  })

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  /* -------------------------------- 资料库 -------------------------------- */
  ipcMain.handle('docs:list', () => resources.listDocuments())
  ipcMain.handle('docs:get', (_event, id: string) => resources.getDocument(id))

  ipcMain.handle('docs:importFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const picked = await dialog.showOpenDialog(win!, {
      title: '导入学习材料',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: FILE_FILTERS
    })
    if (picked.canceled || !picked.filePaths.length) {
      return { ok: true, canceled: true, documents: [] as DocumentRecord[], errors: [] as string[] }
    }
    const documents: DocumentRecord[] = []
    const errors: string[] = []
    for (const filePath of picked.filePaths) {
      try {
        const ingested = await ingestFromFile(filePath)
        const doc = createDocument({
          title: ingested.title,
          sourceType: 'file',
          sourceUri: filePath,
          blocks: ingested.blocks,
          ext: ingested.meta.ext,
          fileName: path.basename(filePath),
          pageCount: ingested.meta.pageCount,
          warnings: ingested.meta.warnings
        })
        documents.push(await resources.saveDocument(doc))
      } catch (error) {
        errors.push(`${path.basename(filePath)}：${errorMessage(error)}`)
      }
    }
    return { ok: documents.length > 0, documents, errors }
  })

  ipcMain.handle('docs:importText', async (_event, title: string, text: string) => {
    try {
      const ingested = ingestFromText(text, title || '手动粘贴的内容')
      const doc = createDocument({
        title: ingested.title,
        sourceType: 'text',
        blocks: ingested.blocks,
        ext: 'txt'
      })
      return { ok: true, document: await resources.saveDocument(doc) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  /** 把网页正文落库成 Document（公开抓取与可登录抓取共用） */
  async function saveWebArticle(article: WebArticle) {
    const blocks: Block[] = article.blocks.map((raw) => ({
      id: newId('b'),
      type: raw.type,
      text: raw.text,
      level: raw.level,
      ordered: raw.ordered
    }))
    const ingested = ingestFromBlocks({
      title: article.title,
      sourceType: 'web',
      sourceUri: article.url,
      blocks,
      ext: 'html',
      warnings: article.warnings
    })
    const doc = createDocument({
      title: ingested.title,
      sourceType: 'web',
      sourceUri: article.url,
      blocks: ingested.blocks,
      ext: 'html',
      warnings: ingested.meta.warnings
    })
    return resources.saveDocument(doc)
  }

  ipcMain.handle('docs:importWeb', async (_event, url: string) => {
    try {
      const article = await fetchWebArticle(url)
      return { ok: true, document: await saveWebArticle(article) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  /* ------------------------- PDF 识图导入（视觉模型） ------------------------ */
  ipcMain.handle('docs:importVisionPdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const picked = await dialog.showOpenDialog(win!, {
      title: 'PDF 识图导入（逐页转写，公式更准）',
      buttonLabel: '开始识别',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
    })
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }

    const settings = await resources.getSettings()
    const provider = activeProvider(settings)
    if (!provider) return { ok: false, error: '还没有配置模型，请先到「设置」选择一个支持图片的模型' }
    if (provider.kind === 'demo') {
      return {
        ok: false,
        error: '识图需要支持图片输入的模型（如通义 qwen-vl-max、OpenAI gpt-4o-mini、智谱 glm-4v）；本地演示模型不支持'
      }
    }
    const apiKey = secrets.get(provider.id) ?? ''
    if (!apiKey) return { ok: false, error: `「${provider.name}」还没有填写 API Key` }

    const client = createAIClient({
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey,
      temperature: 0.1
    })
    const send = (payload: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send('vision:event', payload)
    }

    const documents: DocumentRecord[] = []
    const errors: string[] = []

    for (const filePath of picked.filePaths) {
      const fileName = path.basename(filePath)
      try {
        send({ type: 'progress', file: fileName, phase: 'render', message: '正在把 PDF 页面渲染成图片…' })
        const { pages, total } = await renderPdfPages(filePath, {
          maxPages: 12,
          onPage: (page, limit) =>
            send({ type: 'progress', file: fileName, phase: 'render', message: `渲染第 ${page}/${limit} 页`, current: page, total: limit })
        })

        const markdowns: string[] = []
        for (let index = 0; index < pages.length; index += 1) {
          send({
            type: 'progress',
            file: fileName,
            phase: 'transcribe',
            message: `识别第 ${index + 1}/${pages.length} 页（公式转 LaTeX）`,
            current: index,
            total: pages.length
          })
          const markdown = await client.chat({
            messages: buildPdfPageMessages(pages[index], index + 1, pages.length),
            temperature: 0.1,
            maxTokens: 3000,
            timeoutMs: 180_000
          })
          markdowns.push(markdown)
        }

        const combined = pagesToMarkdown(markdowns)
        const blocks = textToBlocks(combined)
        if (!blocks.length) throw new Error('模型没有返回可用的内容')

        const doc = createDocument({
          title: `${path.basename(filePath, path.extname(filePath))}（识图转写）`,
          sourceType: 'file',
          sourceUri: filePath,
          blocks,
          ext: 'pdf',
          fileName,
          pageCount: total,
          warnings: [
            `由视觉模型逐页转写（${Math.min(total, pages.length)}/${total} 页），公式与数字请对照原 PDF 核对` +
              (total > pages.length ? `；超过 ${pages.length} 页的部分未识别` : '')
          ]
        })
        documents.push(await resources.saveDocument(doc))
      } catch (error) {
        let message = errorMessage(error)
        if (/image|vision|multimodal|400/i.test(message)) {
          message += '（当前模型可能不支持图片输入，请换用 qwen-vl-max / gpt-4o-mini 等视觉模型）'
        }
        errors.push(`${fileName}：${message}`)
      }
    }

    send({
      type: 'done',
      ok: documents.length > 0,
      documents: documents.map((doc) => ({ id: doc.id, title: doc.title })),
      errors
    })
    return { ok: documents.length > 0, documents, errors }
  })

  /* --------------------------- 可登录的实时网页抓取 -------------------------- */  ipcMain.handle('web:openCapture', async (_event, url: string) => openCaptureWindow(url))

  ipcMain.handle('web:captureState', () => captureState())

  ipcMain.handle('web:captureCurrent', async () => {
    const result = await captureCurrentPage()
    if (!result.ok || !result.article) return { ok: false, error: result.error ?? '抓取失败' }
    try {
      return {
        ok: true,
        document: await saveWebArticle(result.article),
        attachments: result.article.attachments ?? []
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  /** 用抓取窗口的登录态批量下载页面里的附件，并逐个导入 */
  ipcMain.handle('web:downloadAttachments', async (_event, items: { url: string; name?: string }[]) => {
    const documents: DocumentRecord[] = []
    const errors: string[] = []
    for (const item of (items ?? []).slice(0, 12)) {
      const label = item.name || item.url
      try {
        const { data, fileName } = await downloadWithCaptureSession(item.url)
        if (data.length > 80 * 1024 * 1024) throw new Error('文件超过 80MB，已跳过')
        const tmp = path.join(app.getPath('temp'), `aitutor-att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${sanitizeFileName(fileName)}`)
        await fs.writeFile(tmp, data)
        try {
          const ingested = await ingestFromFile(tmp)
          const doc = createDocument({
            title: ingested.title || item.name || fileName,
            sourceType: 'web',
            sourceUri: item.url,
            blocks: ingested.blocks,
            ext: ingested.meta.ext,
            fileName,
            pageCount: ingested.meta.pageCount,
            warnings: ingested.meta.warnings
          })
          documents.push(await resources.saveDocument(doc))
        } finally {
          await fs.unlink(tmp).catch(() => undefined)
        }
      } catch (error) {
        errors.push(`${label}：${errorMessage(error)}`)
      }
    }
    return { ok: documents.length > 0, documents, errors }
  })

  ipcMain.handle('web:closeCapture', () => {
    closeCaptureWindow()
  })

  ipcMain.handle('docs:remove', async (_event, id: string) => {
    await resources.deleteDocument(id)
  })

  /* -------------------------------- 讲解产物 ------------------------------- */
  ipcMain.handle('lesson:list', () => resources.listArtifacts())
  ipcMain.handle('lesson:get', (_event, id: string) => resources.getArtifact(id))
  ipcMain.handle('lesson:remove', async (_event, id: string) => {
    await resources.deleteArtifact(id)
  })

  ipcMain.handle('lesson:cancel', () => {
    currentJob?.controller.abort()
  })

  ipcMain.handle('lesson:generate', async (_event, documentId: string) => {
    if (currentJob) return { ok: false, error: '已有讲解任务在生成中，请等它完成或点击取消' }
    const document = await resources.getDocument(documentId)
    if (!document) return { ok: false, error: '材料不存在或已被删除' }

    const settings = await resources.getSettings()
    const provider = activeProvider(settings)
    if (!provider) return { ok: false, error: '还没有配置模型，请先到「设置」里选择一个供应商' }

    const apiKey = provider.kind === 'demo' ? '' : secrets.get(provider.id) ?? ''
    if (provider.kind !== 'demo' && !apiKey) {
      return { ok: false, error: `「${provider.name}」还没有填写 API Key，请到「设置」里填写` }
    }

    const artifact: LessonArtifact = {
      id: newId('art'),
      documentId: document.id,
      documentTitle: document.title,
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'generating',
      outline: [],
      explanations: [],
      keyPoints: [],
      warnings: []
    }
    await resources.saveArtifact(artifact)

    const controller = new AbortController()
    currentJob = { artifactId: artifact.id, controller }
    void runGeneration({
      document,
      artifact,
      provider,
      apiKey,
      useChunkSummary: settings.useChunkSummary,
      signal: controller.signal
    })
    return { ok: true, artifactId: artifact.id }
  })

  async function runGeneration(input: {
    document: DocumentRecord
    artifact: LessonArtifact
    provider: ProviderConfig
    apiKey: string
    useChunkSummary: boolean
    signal: AbortSignal
  }) {
    const { document, artifact, provider, apiKey, signal } = input
    const live: LessonArtifact = { ...artifact, outline: [...artifact.outline], explanations: [...artifact.explanations], keyPoints: [...artifact.keyPoints] }
    let saveTimer: NodeJS.Timeout | null = null
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        void resources.saveArtifact({ ...live, updatedAt: Date.now() })
      }, 800)
    }

    const callbacks: LessonCallbacks = {
      onProgress: (progress) => {
        broadcast({ type: 'progress', artifactId: artifact.id, ...progress })
      },
      onOutline: (outline) => {
        live.outline = outline
        persist()
        broadcast({ type: 'outline', artifactId: artifact.id, outline })
      },
      onDelta: (sectionId, chunk) => broadcast({ type: 'delta', artifactId: artifact.id, sectionId, chunk }),
      onSection: (section) => {
        live.explanations = [...live.explanations.filter((e) => e.sectionId !== section.sectionId), section]
        persist()
        broadcast({
          type: 'section',
          artifactId: artifact.id,
          sectionId: section.sectionId,
          markdown: section.markdown,
          model: section.model
        })
      },
      onKeyPoints: (keyPoints) => {
        live.keyPoints = keyPoints
        persist()
        broadcast({ type: 'keypoints', artifactId: artifact.id, keyPoints })
      },
      onLog: (message) => broadcast({ type: 'log', artifactId: artifact.id, message })
    }

    try {
      let result: LessonArtifact
      if (provider.kind === 'demo') {
        result = await generateMockLesson({ document, artifact: live, callbacks, signal })
      } else {
        const client = createAIClient({
          providerId: provider.id,
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          model: provider.model,
          apiKey,
          temperature: provider.temperature
        })
        result = await generateLesson({
          document,
          artifact: live,
          client,
          callbacks,
          signal,
          useChunkSummary: input.useChunkSummary
        })
      }
      result.outline = live.outline
      result.explanations = live.explanations
      result.keyPoints = live.keyPoints
      await resources.saveArtifact(result)
      broadcast({ type: 'done', artifactId: artifact.id, ok: true, artifact: result })
    } catch (error) {
      const canceled = isCanceled(error)
      const message = canceled ? '已取消本次生成' : errorMessage(error)
      const failed: LessonArtifact = {
        ...live,
        status: canceled ? 'partial' : 'failed',
        error: message,
        updatedAt: Date.now(),
        warnings: canceled ? [...live.warnings, '生成被取消，已完成的部分已保留'] : live.warnings
      }
      await resources.saveArtifact(failed)
      broadcast({ type: 'done', artifactId: artifact.id, ok: false, error: message, artifact: failed })
    } finally {
      if (saveTimer) clearTimeout(saveTimer)
      if (currentJob?.artifactId === artifact.id) currentJob = null
    }
  }

  ipcMain.handle('lesson:regenerateSection', async (_event, artifactId: string, sectionId: string) => {
    const artifact = await resources.getArtifact(artifactId)
    if (!artifact) return { ok: false, error: '讲解记录不存在' }
    const document = await resources.getDocument(artifact.documentId)
    if (!document) return { ok: false, error: '原始材料已被删除，无法重新生成' }
    const node = artifact.outline.find((n) => n.id === sectionId)
    if (!node) return { ok: false, error: '这一节不存在' }

    const settings = await resources.getSettings()
    const provider = settings.providers.find((p) => p.id === artifact.providerId) ?? activeProvider(settings)
    if (!provider) return { ok: false, error: '没有可用的模型配置' }
    const apiKey = provider.kind === 'demo' ? '' : secrets.get(provider.id) ?? ''
    if (provider.kind !== 'demo' && !apiKey) return { ok: false, error: '这个供应商的 API Key 已失效，请到「设置」更新' }

    broadcast({
      type: 'progress',
      artifactId,
      phase: 'explain',
      message: `重新生成：${node.title}`,
      current: 0,
      total: 1,
      title: node.title
    })

    try {
      let markdown: string
      if (provider.kind === 'demo') {
        markdown = `> 演示模式：本节重生成需要接入真实模型\n\n### ${node.title}\n\n在「设置」中切换到 DeepSeek / 通义千问等供应商后，这里会重新生成完整讲解。`
      } else {
        const client = createAIClient({
          providerId: provider.id,
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          model: provider.model,
          apiKey,
          temperature: provider.temperature
        })
        const index = artifact.outline.findIndex((n) => n.id === sectionId)
        markdown = await client.chat({
          messages: buildSectionMessages({
            document,
            outline: artifact.outline,
            node,
            index: index >= 0 ? index : 0,
            excerpt: excerptForSection(document.blocks, node.title, 3800)
          }),
          temperature: provider.temperature,
          maxTokens: 2200,
          timeoutMs: 180_000,
          onDelta: (chunk) => broadcast({ type: 'delta', artifactId, sectionId, chunk })
        })
      }
      const section = {
        sectionId,
        markdown: markdown.trim(),
        updatedAt: Date.now(),
        model: provider.model
      }
      artifact.explanations = [...artifact.explanations.filter((e) => e.sectionId !== sectionId), section]
      artifact.updatedAt = Date.now()
      if (artifact.status === 'failed') artifact.status = 'partial'
      await resources.saveArtifact(artifact)
      broadcast({ type: 'section', artifactId, sectionId, markdown: section.markdown, model: section.model })
      broadcast({ type: 'progress', artifactId, phase: 'done', message: '本节已重新生成' })
      return { ok: true }
    } catch (error) {
      const message = isCanceled(error) ? '已取消' : errorMessage(error)
      broadcast({ type: 'progress', artifactId, phase: 'failed', message })
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('lesson:updateSection', async (_event, artifactId: string, sectionId: string, markdown: string) => {
    const artifact = await resources.getArtifact(artifactId)
    if (!artifact) return { ok: false, error: '讲解记录不存在' }
    const existing = artifact.explanations.find((e) => e.sectionId === sectionId)
    const section = {
      sectionId,
      markdown,
      updatedAt: Date.now(),
      model: existing?.model,
      manual: true
    }
    artifact.explanations = [...artifact.explanations.filter((e) => e.sectionId !== sectionId), section]
    artifact.updatedAt = Date.now()
    if (artifact.status === 'failed') artifact.status = 'partial'
    await resources.saveArtifact(artifact)
    return { ok: true }
  })

  ipcMain.handle('lesson:updateKeyPoint', async (_event, artifactId: string, keyPointId: string, text: string, level: string) => {
    const artifact = await resources.getArtifact(artifactId)
    if (!artifact) return { ok: false }
    artifact.keyPoints = artifact.keyPoints.map((kp) =>
      kp.id === keyPointId ? { ...kp, text, level: level as typeof kp.level } : kp
    )
    artifact.updatedAt = Date.now()
    await resources.saveArtifact(artifact)
    return { ok: true }
  })

  /* --------------------------------- 设置 --------------------------------- */
  ipcMain.handle('settings:get', async () => {
    const settings = await resources.getSettings()
    return { ...settings, providers: settings.providers }
  })

  ipcMain.handle('settings:saveProvider', async (_event, update: ProviderUpdate) => {
    const settings = await resources.getSettings()
    const id = update.id || newId('prov')
    const existing = settings.providers.find((p) => p.id === id)
    const next: ProviderConfig = {
      id,
      name: update.name || existing?.name || '自定义供应商',
      kind: update.kind,
      baseUrl: (update.baseUrl || '').trim(),
      model: (update.model || '').trim(),
      temperature: Number.isFinite(update.temperature) ? update.temperature : 0.6,
      hasKey: existing?.hasKey ?? false
    }
    if (update.apiKey !== undefined) {
      if (update.apiKey.trim()) {
        secrets.set(id, update.apiKey.trim())
        next.hasKey = true
      } else {
        secrets.remove(id)
        next.hasKey = false
      }
    }
    const providers = existing
      ? settings.providers.map((p) => (p.id === id ? next : p))
      : [...settings.providers, next]
    return resources.saveSettings({ ...settings, providers })
  })

  ipcMain.handle('settings:removeProvider', async (_event, id: string) => {
    const settings = await resources.getSettings()
    const providers = settings.providers.filter((p) => p.id !== id)
    if (!providers.length) return settings
    secrets.remove(id)
    const activeProviderId = providers.some((p) => p.id === settings.activeProviderId)
      ? settings.activeProviderId
      : providers[0].id
    return resources.saveSettings({ ...settings, providers, activeProviderId })
  })

  ipcMain.handle('settings:setActive', async (_event, id: string) => {
    const settings = await resources.getSettings()
    if (!settings.providers.some((p) => p.id === id)) return settings
    return resources.saveSettings({ ...settings, activeProviderId: id })
  })

  ipcMain.handle('settings:test', async (_event, update: ProviderUpdate): Promise<TestResult> => {
    if (update.kind === 'demo') {
      return { ok: true, message: '本地演示模型无需联网即可使用（规则生成，仅用于体验流程）' }
    }
    const id = update.id ?? ''
    const key = update.apiKey?.trim() || (id ? secrets.get(id) : null) || ''
    if (!key) return { ok: false, message: '请先填写 API Key' }
    if (!update.baseUrl) return { ok: false, message: '请填写 Base URL（例如 https://api.deepseek.com/v1）' }
    if (!update.model) return { ok: false, message: '请填写模型名称' }
    return testConnection({
      providerId: id || 'test',
      providerName: update.name || '测试',
      baseUrl: update.baseUrl,
      model: update.model,
      apiKey: key,
      temperature: 0
    })
  })

  /* -------------------------------- 习题练习 -------------------------------- */
  ipcMain.handle('practice:list', () => resources.listProblemSets())
  ipcMain.handle('practice:get', (_event, id: string) => resources.getProblemSet(id))

  ipcMain.handle('practice:remove', async (_event, id: string) => {
    await resources.deleteProblemSet(id)
  })

  ipcMain.handle('practice:createManual', async (_event, title: string) => {
    const set: ProblemSet = {
      id: newId('pset'),
      title: (title || '我的题集').trim().slice(0, 80),
      mode: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: [],
      warnings: []
    }
    return { ok: true, set: await resources.saveProblemSet(set) }
  })

  ipcMain.handle('practice:update', async (_event, payload: ProblemSet) => {
    if (!payload?.id) return { ok: false, error: '题集不存在' }
    const existing = await resources.getProblemSet(payload.id)
    if (!existing) return { ok: false, error: '题集已被删除' }
    const saved = await resources.saveProblemSet({ ...payload, updatedAt: Date.now() })
    return { ok: true, set: saved }
  })

  ipcMain.handle(
    'practice:generate',
    async (
      _event,
      input: {
        documentId?: string
        topic?: string
        mode: 'create' | 'extract'
        count: number
        difficulty: 'mixed' | 'easy' | 'medium' | 'hard'
        types: Array<'choice' | 'fill' | 'calc' | 'proof' | 'short'>
        title?: string
      }
    ) => {
      const settings = await resources.getSettings()
      const provider = activeProvider(settings)
      if (!provider) return { ok: false, error: '还没有配置模型，请先到「设置」选择一个供应商' }
      if (provider.kind === 'demo') {
        return { ok: false, error: '出题需要接入真实模型（DeepSeek / 通义千问等），本地演示模型只用于体验讲解流程' }
      }
      const apiKey = secrets.get(provider.id) ?? ''
      if (!apiKey) return { ok: false, error: `「${provider.name}」还没有填写 API Key` }

      let material = (input.topic ?? '').trim()
      let sections: string[] = []
      let contextWarnings: string[] = []
      let checkGrounding = false
      let document: DocumentRecord | null = null
      if (input.documentId) {
        document = await resources.getDocument(input.documentId)
        if (!document) return { ok: false, error: '材料不存在或已被删除' }
        // 不再直接把 plainText 截前 N 字丢给模型：按小节取样，并给出可考查的知识点清单
        const context = buildMaterialContext(document)
        material = context.text
        sections = context.sections
        contextWarnings = context.warnings
        checkGrounding = true
        if (context.usableChars < 400) {
          return {
            ok: false,
            error:
              `这份材料里像样的正文只有约 ${context.usableChars} 字（其余是代码、公式碎片或网页噪声），\n` +
              '直接出题会变成"编题"。建议：\n' +
              '① 换一份文字版材料（Word / 文字型 PDF / 网页抓取的文章）；\n' +
              '② 或先用「PDF 识图导入」把这份 PDF 转成文字，再回来出题。'
          }
        }
      }
      if (!material) return { ok: false, error: '请选择一份材料，或填写出题主题' }

      const client = createAIClient({
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKey,
        temperature: 0.2
      })

      try {
        const { items, warnings } = await generateProblems({
          mode: input.mode,
          material,
          sections,
          count: Math.min(Math.max(input.count || 6, 1), 20),
          difficulty: input.difficulty ?? 'mixed',
          types: input.types ?? [],
          client,
          checkGrounding
        })

        const set: ProblemSet = {
          id: newId('pset'),
          title:
            (input.title || (document ? `${document.title} · 习题` : `${(input.topic ?? '习题').slice(0, 30)} · 习题`)).trim(),
          mode: input.mode,
          documentId: document?.id,
          documentTitle: document?.title,
          topic: document ? undefined : input.topic?.slice(0, 120),
          providerId: provider.id,
          providerName: provider.name,
          model: provider.model,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          items: items.map((item) => ({ ...item, id: newId('prb') })),
          warnings: [...contextWarnings, ...warnings]
        }
        const saved = await resources.saveProblemSet(set)
        return { ok: true, set: saved, warnings }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    }
  )

  /* --------------------------------- 导出 --------------------------------- */
  ipcMain.handle('exporter:run', async (event, artifactId: string, format: ExportFormat) => {
    const artifact = await resources.getArtifact(artifactId)
    if (!artifact) return { ok: false, error: '讲解记录不存在' }
    if (!artifact.explanations.length) return { ok: false, error: '还没有生成内容，无法导出' }

    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const ext = format === 'md' ? 'md' : format
    const saved = await dialog.showSaveDialog(win!, {
      title: '导出讲解',
      buttonLabel: '保存',
      defaultPath: path.join(app.getPath('documents'), `${sanitizeFileName(artifact.documentTitle)}-讲解.${ext}`),
      filters: [{ name: `${ext.toUpperCase()} 文件`, extensions: [ext] }]
    })
    if (saved.canceled || !saved.filePath) return { ok: false, canceled: true }
    try {
      if (format === 'docx') await exportDocx(artifact, saved.filePath)
      else if (format === 'pptx') await exportPptx(artifact, saved.filePath)
      else if (format === 'md') await exportMarkdown(artifact, saved.filePath)
      else await exportPdf(artifact, saved.filePath, (html) => printHtmlToPdf(html))
      return { ok: true, path: saved.filePath }
    } catch (error) {
      return { ok: false, error: `导出失败：${errorMessage(error)}` }
    }
  })

  return {
    encryptionAvailable: encryptionAvailable()
  }
}
