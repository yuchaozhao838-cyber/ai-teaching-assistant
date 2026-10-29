/**
 * 手机版（浏览器）的 window.tutor 实现：
 * 用 IndexedDB 存数据，AI 直接走 fetch（DeepSeek / 通义都支持跨域），
 * 讲解与练习的编排逻辑从桌面端主进程移植过来。
 */
import { AIError, createAIClient, isCanceled, testConnection } from '@tutor/ai-core'
import {
  PROMPT_VERSION,
  buildPdfPageMessages,
  buildSectionMessages,
  generateLesson,
  generateMockLesson,
  pagesToMarkdown
} from '@tutor/pedagogy'
import { buildMaterialContext, generateProblems } from '@tutor/practice'
import { PROVIDER_PRESETS } from '@tutor/shared'
import type {
  AppSettings,
  DocumentRecord,
  ExportFormat,
  LessonArtifact,
  LessonEvent,
  ProblemSet,
  ProviderConfig,
  ProviderUpdate,
  TestResult,
  TutorApi,
  VisionEvent
} from '@tutor/shared'
import { store } from './db'
import { ingestBrowserFile, ingestText, renderPdfPages } from './ingest'
import { createDocument, newId, textToBlocks } from './shim'

/* -------------------------------- 基础工具 -------------------------------- */

function uid(prefix: string): string {
  return newId(prefix)
}

function errorMessage(error: unknown): string {
  if (error instanceof AIError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

function activeProvider(settings: AppSettings): ProviderConfig | undefined {
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0]
}

const DEMO_PRESET = PROVIDER_PRESETS.find((p) => p.id === 'demo')!

function defaultSettings(): AppSettings {
  return {
    activeProviderId: DEMO_PRESET.id,
    providers: [
      {
        id: DEMO_PRESET.id,
        name: DEMO_PRESET.name,
        kind: DEMO_PRESET.kind,
        baseUrl: DEMO_PRESET.baseUrl,
        model: DEMO_PRESET.model,
        temperature: 0.6,
        hasKey: true
      }
    ],
    useChunkSummary: true
  }
}

async function getSettings(): Promise<AppSettings> {
  const saved = await store.kvGet<AppSettings>('settings', defaultSettings())
  const providers = (saved.providers ?? []).map((provider) => ({
    ...provider,
    temperature: Number.isFinite(provider.temperature) ? provider.temperature : 0.6,
    hasKey: provider.kind === 'demo' ? true : Boolean((secretsCache[provider.id] ?? '').length)
  }))
  return {
    ...saved,
    providers: providers.length ? providers : defaultSettings().providers,
    activeProviderId: providers.some((p) => p.id === saved.activeProviderId) ? saved.activeProviderId : providers[0].id,
    useChunkSummary: saved.useChunkSummary ?? true
  }
}

async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await store.kvSet('settings', settings)
  return getSettings()
}

/* --------------------------------- 密钥 ---------------------------------- */

let secretsCache: Record<string, string> = {}
let secretsLoaded = false

async function loadSecrets(): Promise<void> {
  if (secretsLoaded) return
  secretsCache = await store.kvGet<Record<string, string>>('secrets', {})
  secretsLoaded = true
}

function getKey(id: string): string | null {
  return secretsCache[id] ?? null
}

async function setKey(id: string, value: string): Promise<void> {
  secretsCache = { ...secretsCache, [id]: value }
  await store.kvSet('secrets', secretsCache)
}

async function removeKey(id: string): Promise<void> {
  const next = { ...secretsCache }
  delete next[id]
  secretsCache = next
  await store.kvSet('secrets', secretsCache)
}

/* -------------------------------- 事件广播 -------------------------------- */

const lessonListeners = new Set<(event: LessonEvent) => void>()
const visionListeners = new Set<(event: VisionEvent) => void>()

function emitLesson(event: LessonEvent) {
  for (const listener of lessonListeners) listener(event)
}

function emitVision(event: VisionEvent) {
  for (const listener of visionListeners) listener(event)
}

/* ------------------------------ 文件选择器 ------------------------------ */

function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => finish([]), 1500)
      },
      { once: true }
    )
    document.body.appendChild(input)
    input.click()
  })
}

/* --------------------------------- 讲解 ---------------------------------- */

let currentJob: { artifactId: string; controller: AbortController } | null = null

async function saveArtifact(artifact: LessonArtifact): Promise<LessonArtifact> {
  await store.put('artifacts', artifact)
  return artifact
}

async function runGeneration(input: {
  document: DocumentRecord
  artifact: LessonArtifact
  provider: ProviderConfig
  apiKey: string
  useChunkSummary: boolean
  signal: AbortSignal
}) {
  const { document, artifact, provider, apiKey, signal } = input
  const live: LessonArtifact = {
    ...artifact,
    outline: [...artifact.outline],
    explanations: [...artifact.explanations],
    keyPoints: [...artifact.keyPoints]
  }
  let saveTimer: number | null = null
  const persist = () => {
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void saveArtifact({ ...live, updatedAt: Date.now() })
    }, 800)
  }

  const callbacks = {
    onProgress: (progress: { phase: LessonArtifact['status'] extends never ? never : Parameters<typeof generateLesson>[0]['callbacks'] extends never ? never : never }) => void progress
  } as never

  try {
    let result: LessonArtifact
    const realCallbacks = {
      onProgress: (progress: Record<string, unknown>) => emitLesson({ type: 'progress', artifactId: artifact.id, ...(progress as object) } as LessonEvent),
      onOutline: (outline: LessonArtifact['outline']) => {
        live.outline = outline
        persist()
        emitLesson({ type: 'outline', artifactId: artifact.id, outline })
      },
      onDelta: (sectionId: string, chunk: string) =>
        emitLesson({ type: 'delta', artifactId: artifact.id, sectionId, chunk }),
      onSection: (section: LessonArtifact['explanations'][number]) => {
        live.explanations = [...live.explanations.filter((item) => item.sectionId !== section.sectionId), section]
        persist()
        emitLesson({
          type: 'section',
          artifactId: artifact.id,
          sectionId: section.sectionId,
          markdown: section.markdown,
          model: section.model
        })
      },
      onKeyPoints: (keyPoints: LessonArtifact['keyPoints']) => {
        live.keyPoints = keyPoints
        persist()
        emitLesson({ type: 'keypoints', artifactId: artifact.id, keyPoints })
      },
      onLog: (message: string) => emitLesson({ type: 'log', artifactId: artifact.id, message })
    }
    void callbacks

    if (provider.kind === 'demo') {
      result = await generateMockLesson({ document, artifact: live, callbacks: realCallbacks, signal } as never)
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
        callbacks: realCallbacks,
        signal,
        useChunkSummary: input.useChunkSummary
      } as never)
    }

    result.outline = live.outline
    result.explanations = live.explanations
    result.keyPoints = live.keyPoints
    await saveArtifact(result)
    emitLesson({ type: 'done', artifactId: artifact.id, ok: true, artifact: result })
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
    await saveArtifact(failed)
    emitLesson({ type: 'done', artifactId: artifact.id, ok: false, error: message, artifact: failed })
  } finally {
    if (saveTimer) window.clearTimeout(saveTimer)
    if (currentJob?.artifactId === artifact.id) currentJob = null
  }
}

/* -------------------------------- 习题练习 -------------------------------- */

async function generateProblemSet(input: {
  documentId?: string
  topic?: string
  mode: 'create' | 'extract'
  count: number
  difficulty: 'mixed' | 'easy' | 'medium' | 'hard'
  types: Array<'choice' | 'fill' | 'calc' | 'proof' | 'short'>
  title?: string
}) {
  const settings = await getSettings()
  const provider = activeProvider(settings)
  if (!provider) return { ok: false as const, error: '还没有配置模型，请先到「设置」选择一个供应商' }
  if (provider.kind === 'demo') {
    return { ok: false as const, error: '出题需要接入真实模型（DeepSeek / 通义千问等），本地演示模型只用于体验讲解流程' }
  }
  const apiKey = getKey(provider.id) ?? ''
  if (!apiKey) return { ok: false as const, error: `「${provider.name}」还没有填写 API Key` }

  let material = (input.topic ?? '').trim()
  let sections: string[] = []
  let contextWarnings: string[] = []
  let checkGrounding = false
  let document: DocumentRecord | null = null

  if (input.documentId) {
    document = (await store.get<DocumentRecord>('docs', input.documentId)) ?? null
    if (!document) return { ok: false as const, error: '材料不存在或已被删除' }
    const context = buildMaterialContext(document)
    material = context.text
    sections = context.sections
    contextWarnings = context.warnings
    checkGrounding = true
    if (context.usableChars < 400) {
      return {
        ok: false as const,
        error: `这份材料里像样的正文只有约 ${context.usableChars} 字，直接出题会变成"编题"。建议换一份文字版材料，或先用「PDF 识图导入」。`
      }
    }
  }
  if (!material) return { ok: false as const, error: '请选择一份材料，或填写出题主题' }

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
      id: uid('pset'),
      title: (input.title || (document ? `${document.title} · 习题` : `${(input.topic ?? '习题').slice(0, 30)} · 习题`)).trim(),
      mode: input.mode,
      documentId: document?.id,
      documentTitle: document?.title,
      topic: document ? undefined : input.topic?.slice(0, 120),
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: items.map((item) => ({ ...item, id: uid('prb') })),
      warnings: [...contextWarnings, ...warnings]
    }
    await store.put('practice', set)
    return { ok: true as const, set, warnings: set.warnings }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}

/* -------------------------------- PDF 识图 -------------------------------- */

async function importVisionPdf(): Promise<{
  ok: boolean
  canceled?: boolean
  documents?: DocumentRecord[]
  errors?: string[]
  error?: string
}> {
  const files = await pickFiles('.pdf,application/pdf')
  if (!files.length) return { ok: false, canceled: true }

  const settings = await getSettings()
  const provider = activeProvider(settings)
  if (!provider) return { ok: false, error: '还没有配置模型' }
  if (provider.kind === 'demo') {
    return { ok: false, error: '识图需要支持图片输入的模型（qwen-vl-max / gpt-4o-mini / glm-4v）' }
  }
  const apiKey = getKey(provider.id) ?? ''
  if (!apiKey) return { ok: false, error: `「${provider.name}」还没有填写 API Key` }

  const client = createAIClient({
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey,
    temperature: 0.1
  })

  const documents: DocumentRecord[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      emitVision({ type: 'progress', file: file.name, phase: 'render', message: '正在把 PDF 页面渲染成图片…' })
      const buffer = await file.arrayBuffer()
      const { pages, total } = await renderPdfPages(buffer, { maxPages: 10 })
      const markdowns: string[] = []
      for (let index = 0; index < pages.length; index += 1) {
        emitVision({
          type: 'progress',
          file: file.name,
          phase: 'transcribe',
          message: `识别第 ${index + 1}/${pages.length} 页`,
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
      const blocks = textToBlocks(pagesToMarkdown(markdowns))
      if (!blocks.length) throw new Error('模型没有返回可用内容')
      documents.push(
        createDocument({
          title: `${file.name.replace(/\.pdf$/i, '')}（识图转写）`,
          sourceType: 'file',
          sourceUri: file.name,
          blocks,
          ext: 'pdf',
          fileName: file.name,
          pageCount: total,
          warnings: [`由视觉模型逐页转写（${Math.min(total, pages.length)}/${total} 页），公式请对照原 PDF`]
        })
      )
    } catch (error) {
      let message = errorMessage(error)
      if (/image|vision|multimodal|400/i.test(message)) message += '（当前模型可能不支持图片输入）'
      errors.push(`${file.name}：${message}`)
    }
  }

  emitVision({ type: 'done', ok: documents.length > 0, documents: documents.map((doc) => ({ id: doc.id, title: doc.title })), errors })
  return { ok: documents.length > 0, documents, errors }
}

/* --------------------------------- 对外 API -------------------------------- */

export function createBrowserTutor(): TutorApi {
  void loadSecrets()

  return {
    app: {
      info: async () => ({
        version: '1.0.0-mobile',
        platform: /android/i.test(navigator.userAgent) ? 'android' : /iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'web',
        dataDir: '浏览器本地存储（IndexedDB）',
        electron: '—',
        chrome: navigator.userAgent
      }),
      openDataDir: async () => undefined,
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener')
      }
    },

    docs: {
      list: async () => {
        const docs = await store.all<DocumentRecord>('docs')
        return [...docs].sort((a, b) => b.createdAt - a.createdAt)
      },
      get: async (id: string) => (await store.get<DocumentRecord>('docs', id)) ?? null,
      importFiles: async () => {
        const files = await pickFiles('.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json', true)
        if (!files.length) return { ok: false, canceled: true, documents: [], errors: [] }
        const documents: DocumentRecord[] = []
        const errors: string[] = []
        for (const file of files) {
          try {
            const document = await ingestBrowserFile(file)
            await store.put('docs', document)
            documents.push(document)
          } catch (error) {
            errors.push(`${file.name}：${errorMessage(error)}`)
          }
        }
        return { ok: documents.length > 0, documents, errors }
      },
      importText: async (title: string, text: string) => {
        try {
          const document = ingestText(title.trim() || '粘贴的文本', text)
          await store.put('docs', document)
          return { ok: true, document }
        } catch (error) {
          return { ok: false, error: errorMessage(error) }
        }
      },
      importWeb: async () => ({
        ok: false,
        error: '手机版不支持网页抓取（浏览器有跨域限制）。可以：① 在浏览器里打开文章 → 全选复制 → 用「粘贴文本」；② 用电脑版抓取后导出，再导入。'
      }),
      importVisionPdf,
      onVisionEvent: (callback: (event: VisionEvent) => void) => {
        visionListeners.add(callback)
        return () => visionListeners.delete(callback)
      },
      remove: async (id: string) => {
        await store.remove('docs', id)
        const artifacts = await store.all<LessonArtifact>('artifacts')
        for (const artifact of artifacts.filter((item) => item.documentId === id)) {
          await store.remove('artifacts', artifact.id)
        }
      }
    },

    web: {
      openCapture: async () => ({ ok: false, error: '手机版不支持抓取窗口' }),
      captureState: async () => ({ open: false, url: '', title: '' }),
      captureCurrent: async () => ({ ok: false, error: '手机版不支持抓取窗口' }),
      downloadAttachments: async () => ({ ok: false, documents: [], errors: ['手机版不支持附件下载'] }),
      closeCapture: async () => undefined
    },

    lesson: {
      list: async () => {
        const artifacts = await store.all<LessonArtifact>('artifacts')
        return [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt)
      },
      get: async (id: string) => (await store.get<LessonArtifact>('artifacts', id)) ?? null,
      generate: async (documentId: string) => {
        if (currentJob) return { ok: false, error: '已有讲解任务在生成中' }
        const document = await store.get<DocumentRecord>('docs', documentId)
        if (!document) return { ok: false, error: '材料不存在或已被删除' }
        const settings = await getSettings()
        const provider = activeProvider(settings)
        if (!provider) return { ok: false, error: '还没有配置模型，请先到「设置」里选择供应商' }
        const apiKey = provider.kind === 'demo' ? '' : getKey(provider.id) ?? ''
        if (provider.kind !== 'demo' && !apiKey) return { ok: false, error: `「${provider.name}」还没有填写 API Key` }

        const artifact: LessonArtifact = {
          id: uid('art'),
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
        await saveArtifact(artifact)
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
      },
      regenerateSection: async (artifactId: string, sectionId: string) => {
        const artifact = await store.get<LessonArtifact>('artifacts', artifactId)
        if (!artifact) return { ok: false, error: '讲解记录不存在' }
        const document = await store.get<DocumentRecord>('docs', artifact.documentId)
        if (!document) return { ok: false, error: '原始材料已被删除' }
        const node = artifact.outline.find((item) => item.id === sectionId)
        if (!node) return { ok: false, error: '这一节不存在' }
        const settings = await getSettings()
        const provider = settings.providers.find((item) => item.id === artifact.providerId) ?? activeProvider(settings)
        if (!provider) return { ok: false, error: '没有可用的模型配置' }
        const apiKey = provider.kind === 'demo' ? '' : getKey(provider.id) ?? ''
        if (provider.kind !== 'demo' && !apiKey) return { ok: false, error: 'API Key 已失效，请到「设置」更新' }

        try {
          let markdown: string
          if (provider.kind === 'demo') {
            markdown = `> 演示模式：本节重生成需要接入真实模型\n\n### ${node.title}`
          } else {
            const client = createAIClient({
              providerId: provider.id,
              providerName: provider.name,
              baseUrl: provider.baseUrl,
              model: provider.model,
              apiKey,
              temperature: provider.temperature
            })
            const index = artifact.outline.findIndex((item) => item.id === sectionId)
            markdown = await client.chat({
              messages: buildSectionMessages({
                document,
                artifact,
                node,
                index,
                total: artifact.outline.length
              } as never),
              temperature: provider.temperature
            })
          }
          const next: LessonArtifact = {
            ...artifact,
            explanations: [
              ...artifact.explanations.filter((item) => item.sectionId !== sectionId),
              { sectionId, markdown, model: provider.model, updatedAt: Date.now() }
            ],
            updatedAt: Date.now()
          }
          await saveArtifact(next)
          emitLesson({ type: 'section', artifactId, sectionId, markdown, model: provider.model })
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorMessage(error) }
        }
      },
      cancel: async () => {
        currentJob?.controller.abort()
      },
      updateSection: async (artifactId: string, sectionId: string, markdown: string) => {
        const artifact = await store.get<LessonArtifact>('artifacts', artifactId)
        if (!artifact) return { ok: false, error: '讲解记录不存在' }
        const next: LessonArtifact = {
          ...artifact,
          explanations: artifact.explanations.map((item) =>
            item.sectionId === sectionId ? { ...item, markdown, edited: true } : item
          ),
          updatedAt: Date.now()
        }
        await saveArtifact(next)
        return { ok: true }
      },
      updateKeyPoint: async (artifactId: string, keyPointId: string, text: string, level: string) => {
        const artifact = await store.get<LessonArtifact>('artifacts', artifactId)
        if (!artifact) return { ok: false }
        const next: LessonArtifact = {
          ...artifact,
          keyPoints: artifact.keyPoints.map((item) =>
            item.id === keyPointId ? { ...item, text, level: level as never } : item
          ),
          updatedAt: Date.now()
        }
        await saveArtifact(next)
        return { ok: true }
      },
      remove: async (id: string) => {
        await store.remove('artifacts', id)
      },
      onEvent: (callback: (event: LessonEvent) => void) => {
        lessonListeners.add(callback)
        return () => lessonListeners.delete(callback)
      }
    },

    practice: {
      list: async () => {
        const sets = await store.all<ProblemSet>('practice')
        return [...sets].sort((a, b) => b.updatedAt - a.updatedAt)
      },
      get: async (id: string) => (await store.get<ProblemSet>('practice', id)) ?? null,
      generate: generateProblemSet,
      createManual: async (title: string) => {
        const set: ProblemSet = {
          id: uid('pset'),
          title: (title || '我的题集').trim().slice(0, 80),
          mode: 'manual',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          items: [],
          warnings: []
        }
        await store.put('practice', set)
        return { ok: true, set }
      },
      update: async (set: ProblemSet) => {
        const existing = await store.get<ProblemSet>('practice', set.id)
        if (!existing) return { ok: false, error: '题集已被删除' }
        const saved = { ...set, updatedAt: Date.now() }
        await store.put('practice', saved)
        return { ok: true, set: saved }
      },
      remove: async (id: string) => {
        await store.remove('practice', id)
      }
    },

    settings: {
      get: getSettings,
      saveProvider: async (update: ProviderUpdate) => {
        const settings = await getSettings()
        const id = update.id || uid('prov')
        const existing = settings.providers.find((provider) => provider.id === id)
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
            await setKey(id, update.apiKey.trim())
            next.hasKey = true
          } else {
            await removeKey(id)
            next.hasKey = false
          }
        }
        const providers = existing
          ? settings.providers.map((provider) => (provider.id === id ? next : provider))
          : [...settings.providers, next]
        return saveSettings({ ...settings, providers })
      },
      removeProvider: async (id: string) => {
        const settings = await getSettings()
        const providers = settings.providers.filter((provider) => provider.id !== id)
        if (!providers.length) return settings
        await removeKey(id)
        const activeProviderId = providers.some((provider) => provider.id === settings.activeProviderId)
          ? settings.activeProviderId
          : providers[0].id
        return saveSettings({ ...settings, providers, activeProviderId })
      },
      setActive: async (id: string) => {
        const settings = await getSettings()
        if (!settings.providers.some((provider) => provider.id === id)) return settings
        return saveSettings({ ...settings, activeProviderId: id })
      },
      test: async (update: ProviderUpdate): Promise<TestResult> => {
        if (update.kind === 'demo') {
          return { ok: true, message: '本地演示模型无需联网（规则生成，仅用于体验流程）' }
        }
        const id = update.id ?? ''
        const key = update.apiKey?.trim() || (id ? getKey(id) : null) || ''
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
      }
    },

    exporter: {
      run: async (artifactId: string, format: ExportFormat) => {
        // 手机没有打印/Office 能力，最实用的是导出一份 Markdown 下载到「下载」目录
        if (format !== 'md') {
          throw new Error('手机版只支持导出 Markdown；Word / PPT / PDF 导出请在电脑版操作')
        }
        const artifact = await store.get<LessonArtifact>('artifacts', artifactId)
        if (!artifact) throw new Error('讲解记录不存在')
        const markdown = lessonToMarkdown(artifact)
        const fileName = `${artifact.documentTitle || '讲解'}.md`.replace(/[\\/:*?"<>|]/g, '-')
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 5000)
        return { ok: true, path: fileName }
      }
    }
  } as TutorApi
}

/** 把讲解产物导出成 Markdown（手机版导出用） */
export function lessonToMarkdown(artifact: LessonArtifact): string {
  const lines: string[] = []
  lines.push(`# ${artifact.documentTitle}`)
  lines.push('')
  lines.push(`> 生成模型：${artifact.providerName} · ${artifact.model}`)
  lines.push(`> 生成时间：${new Date(artifact.createdAt).toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 讲解大纲')
  lines.push('')
  artifact.outline.forEach((node, index) => {
    lines.push(`${index + 1}. ${node.title}${node.summary ? ` —— ${node.summary}` : ''}`)
  })
  lines.push('')

  for (const node of artifact.outline) {
    const section = artifact.explanations.find((item) => item.sectionId === node.id)
    if (!section) continue
    lines.push('---')
    lines.push('')
    lines.push(`## ${node.title}`)
    lines.push('')
    lines.push(section.markdown.trim())
    lines.push('')
  }

  const levels: Array<{ level: 'high' | 'medium' | 'low'; label: string }> = [
    { level: 'high', label: '必须掌握' },
    { level: 'medium', label: '理解即可' },
    { level: 'low', label: '了解即可' }
  ]
  lines.push('---')
  lines.push('')
  lines.push('## 重点划分')
  for (const item of levels) {
    const points = artifact.keyPoints.filter((point) => point.level === item.level)
    if (!points.length) continue
    lines.push('')
    lines.push(`### ${item.label}（${points.length}）`)
    lines.push('')
    for (const point of points) {
      const section = artifact.outline.find((node) => node.id === point.sectionId)
      lines.push(`- ${point.text}${section ? `（${section.title}）` : ''}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export function installBrowserTutor(): void {
  const tutor = createBrowserTutor()
  ;(window as unknown as { tutor: TutorApi }).tutor = tutor
}
