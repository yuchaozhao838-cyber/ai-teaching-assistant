import { reactive } from 'vue'
import type {
  AppSettings,
  DocumentRecord,
  ExportFormat,
  ExportResult,
  LessonArtifact,
  LessonEvent,
  LessonPhase,
  OutlineNode,
  ProblemSet,
  ProviderUpdate,
  TestResult
} from '@tutor/shared'

export type ViewKey = 'library' | 'lesson' | 'practice' | 'settings'

export interface ProgressState {
  phase: LessonPhase
  message: string
  current?: number
  total?: number
  title?: string
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  electron: string
  chrome: string
  encryptionAvailable?: boolean
}

export const state = reactive({
  ready: false,
  view: 'library' as ViewKey,
  docs: [] as DocumentRecord[],
  artifacts: [] as LessonArtifact[],
  problemSets: [] as ProblemSet[],
  settings: null as AppSettings | null,
  info: null as AppInfo | null,
  activeDocId: '',
  activeArtifactId: '',
  artifact: null as LessonArtifact | null,
  generating: false,
  canceling: false,
  progress: null as ProgressState | null,
  streamings: {} as Record<string, string>,
  error: '',
  logs: [] as string[]
})

const pendingDeltas: Record<string, string> = {}
let flushTimer: number | null = null

function queueDelta(sectionId: string, chunk: string) {
  pendingDeltas[sectionId] = (pendingDeltas[sectionId] ?? '') + chunk
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    for (const [id, text] of Object.entries(pendingDeltas)) {
      state.streamings[id] = (state.streamings[id] ?? '') + text
      delete pendingDeltas[id]
    }
  }, 45)
}

function clearStreamings() {
  for (const key of Object.keys(state.streamings)) delete state.streamings[key]
  for (const key of Object.keys(pendingDeltas)) delete pendingDeltas[key]
}

function ensureArtifact(artifactId: string) {
  if (state.artifact && state.artifact.id === artifactId) return
  // 事件可能先于 invoke 的返回值到达，这里先建一个占位壳，避免丢事件
  state.artifact = {
    id: artifactId,
    documentId: state.activeDocId,
    documentTitle: activeDoc()?.title ?? '',
    providerId: '',
    providerName: '',
    model: '',
    promptVersion: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'generating',
    outline: [],
    explanations: [],
    keyPoints: [],
    warnings: []
  }
}

function upsertExplanation(sectionId: string, markdown: string, model?: string) {
  if (!state.artifact) return
  const rest = state.artifact.explanations.filter((e) => e.sectionId !== sectionId)
  state.artifact.explanations = [...rest, { sectionId, markdown, updatedAt: Date.now(), model }]
}

function handleLessonEvent(event: LessonEvent) {
  const isActive = event.type === 'done' || event.artifactId === state.activeArtifactId

  switch (event.type) {
    case 'progress':
      if (!isActive) return
      state.progress = {
        phase: event.phase,
        message: event.message,
        current: event.current,
        total: event.total,
        title: event.title
      }
      if (event.phase === 'done' || event.phase === 'failed') state.canceling = false
      break
    case 'outline':
      if (!isActive) return
      ensureArtifact(event.artifactId)
      if (state.artifact) state.artifact.outline = event.outline
      break
    case 'delta':
      if (!isActive) return
      queueDelta(event.sectionId, event.chunk)
      break
    case 'section':
      if (!isActive) return
      ensureArtifact(event.artifactId)
      upsertExplanation(event.sectionId, event.markdown, event.model)
      delete state.streamings[event.sectionId]
      break
    case 'keypoints':
      if (!isActive) return
      ensureArtifact(event.artifactId)
      if (state.artifact) state.artifact.keyPoints = event.keyPoints
      break
    case 'log':
      if (!isActive) return
      state.logs.push(event.message)
      break
    case 'done':
      state.generating = false
      state.canceling = false
      if (event.artifact) {
        if (event.artifactId === state.activeArtifactId) {
          state.artifact = event.artifact
        }
      }
      if (!event.ok) {
        state.error = event.error || '生成失败'
      }
      clearStreamings()
      void refreshArtifacts()
      break
    default:
      break
  }
}

export async function refreshDocs() {
  state.docs = await window.tutor.docs.list()
}

export async function refreshArtifacts() {
  state.artifacts = await window.tutor.lesson.list()
}

/* -------------------------------- 习题练习 -------------------------------- */

export async function loadProblemSets() {
  state.problemSets = await window.tutor.practice.list()
}

export async function generateProblemSet(payload: {
  documentId?: string
  topic?: string
  mode: 'create' | 'extract'
  count: number
  difficulty: 'mixed' | 'easy' | 'medium' | 'hard'
  types: Array<'choice' | 'fill' | 'calc' | 'proof' | 'short'>
}) {
  const result = await window.tutor.practice.generate(toPlain(payload))
  if (result.ok && result.set) {
    state.problemSets = [result.set, ...state.problemSets.filter((s) => s.id !== result.set!.id)]
  }
  return result
}

export async function createManualProblemSet(title: string) {
  const result = await window.tutor.practice.createManual(title)
  if (result.ok && result.set) state.problemSets = [result.set, ...state.problemSets]
  return result
}

/**
 * IPC 走的是结构化克隆，Vue 的 reactive/ref 是 Proxy，直接传会报
 * "An object could not be cloned"，所以跨进程前先转成纯数据。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function saveProblemSet(set: ProblemSet) {
  const result = await window.tutor.practice.update(toPlain(set))
  if (result.ok && result.set) {
    state.problemSets = state.problemSets.map((s) => (s.id === result.set!.id ? result.set! : s))
  }
  return result
}

export async function deleteProblemSet(id: string) {
  await window.tutor.practice.remove(id)
  state.problemSets = state.problemSets.filter((s) => s.id !== id)
}

export async function initStore() {
  if (state.ready) return
  try {
    if (!window.tutor) throw new Error('window.tutor 不存在：preload 未生效')
    const [docs, artifacts, problemSets, settings, info] = await Promise.all([
      window.tutor.docs.list(),
      window.tutor.lesson.list(),
      window.tutor.practice.list(),
      window.tutor.settings.get(),
      window.tutor.app.info()
    ])
    state.docs = docs
    state.artifacts = artifacts
    state.problemSets = problemSets
    state.settings = settings
    state.info = info
    window.tutor.lesson.onEvent(handleLessonEvent)

    const interrupted = artifacts.find((a) => a.status === 'generating')
    if (interrupted) {
      state.activeArtifactId = interrupted.id
      state.artifact = interrupted
      state.activeDocId = interrupted.documentId
    }
  } catch (error) {
    state.error = `初始化失败：${(error as Error)?.message ?? String(error)}（可查看 %APPDATA%\\AITutorAssistant\\startup.log）`
    console.error('[initStore]', error)
  } finally {
    state.ready = true
  }
}

export function goLibrary() {
  state.view = 'library'
}

export async function goPractice() {
  state.view = 'practice'
  await loadProblemSets()
}

export function goSettings() {
  state.view = 'settings'
}

export function activeProvider() {
  if (!state.settings) return undefined
  return (
    state.settings.providers.find((p) => p.id === state.settings?.activeProviderId) ?? state.settings.providers[0]
  )
}

export function activeDoc(): DocumentRecord | undefined {
  return state.docs.find((d) => d.id === state.activeDocId)
}

export function artifactOfDocument(documentId: string): LessonArtifact | undefined {
  return [...state.artifacts]
    .filter((a) => a.documentId === documentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export async function importFiles() {
  const result = await window.tutor.docs.importFiles()
  if (!result.canceled) await Promise.all([refreshDocs(), refreshArtifacts()])
  return result
}

export async function importText(title: string, text: string) {
  const result = await window.tutor.docs.importText(title, text)
  if (result.ok) await refreshDocs()
  return result
}

export async function importWeb(url: string) {
  const result = await window.tutor.docs.importWeb(url)
  if (result.ok) await refreshDocs()
  return result
}

export async function removeDocument(id: string) {
  await window.tutor.docs.remove(id)
  if (state.activeDocId === id) {
    state.activeDocId = ''
    state.activeArtifactId = ''
    state.artifact = null
    state.view = 'library'
  }
  await Promise.all([refreshDocs(), refreshArtifacts()])
}

export async function openDocument(docId: string) {
  state.activeDocId = docId
  state.error = ''
  const latest = artifactOfDocument(docId)
  if (latest) {
    await openArtifact(latest.id)
    return
  }
  state.activeArtifactId = ''
  state.artifact = null
  state.generating = false
  state.progress = null
  clearStreamings()
  state.view = 'lesson'
}

export async function openArtifact(id: string) {
  const artifact = await window.tutor.lesson.get(id)
  if (!artifact) return
  state.activeArtifactId = id
  state.activeDocId = artifact.documentId
  state.artifact = artifact
  state.generating = artifact.status === 'generating' && state.generating
  state.error = artifact.status === 'failed' ? artifact.error ?? '' : ''
  clearStreamings()
  state.view = 'lesson'
}

export async function startLesson(docId: string) {
  const result = await window.tutor.lesson.generate(docId)
  if (!result.ok || !result.artifactId) return result

  state.activeDocId = docId
  state.activeArtifactId = result.artifactId
  state.generating = true
  state.canceling = false
  state.error = ''
  state.logs = []
  state.progress = { phase: 'prepare', message: '正在准备材料…' }
  clearStreamings()
  state.view = 'lesson'

  const shell = await window.tutor.lesson.get(result.artifactId)
  const live = state.artifact && state.artifact.id === result.artifactId ? state.artifact : null
  if (shell) {
    state.artifact = live
      ? {
          ...shell,
          outline: live.outline.length ? live.outline : shell.outline,
          explanations: live.explanations.length ? live.explanations : shell.explanations,
          keyPoints: live.keyPoints.length ? live.keyPoints : shell.keyPoints
        }
      : shell
  } else if (!live) {
    ensureArtifact(result.artifactId)
  }

  await refreshArtifacts()
  return result
}

export async function regenerateLesson() {
  if (!state.artifact) return { ok: false, error: '没有可重新生成的讲解' }
  return startLesson(state.artifact.documentId)
}

export async function cancelGeneration() {
  state.canceling = true
  await window.tutor.lesson.cancel()
}

export async function saveSection(sectionId: string, markdown: string) {
  if (!state.artifact) return { ok: false }
  const result = await window.tutor.lesson.updateSection(state.artifact.id, sectionId, markdown)
  if (result.ok) upsertExplanation(sectionId, markdown)
  return result
}

export async function regenerateSection(sectionId: string) {
  if (!state.artifact) return { ok: false, error: '没有可用的讲解' }
  state.error = ''
  const result = await window.tutor.lesson.regenerateSection(state.artifact.id, sectionId)
  if (!result.ok) state.error = result.error ?? '重新生成失败'
  return result
}

export async function deleteArtifact(id: string) {
  await window.tutor.lesson.remove(id)
  if (state.activeArtifactId === id) {
    state.activeArtifactId = ''
    state.artifact = null
    state.view = 'library'
  }
  await refreshArtifacts()
}

export async function exportArtifact(format: ExportFormat): Promise<ExportResult> {
  if (!state.artifact) return { ok: false, error: '没有可导出的讲解' }
  return window.tutor.exporter.run(state.artifact.id, format)
}

export async function saveProvider(payload: ProviderUpdate) {
  state.settings = await window.tutor.settings.saveProvider(payload)
  return state.settings
}

export async function removeProvider(id: string) {
  state.settings = await window.tutor.settings.removeProvider(id)
  return state.settings
}

export async function setActiveProvider(id: string) {
  state.settings = await window.tutor.settings.setActive(id)
  return state.settings
}

export async function testProvider(payload: ProviderUpdate): Promise<TestResult> {
  return window.tutor.settings.test(payload)
}

export function explanationOf(sectionId: string) {
  return state.artifact?.explanations.find((e) => e.sectionId === sectionId)
}

export function keyPointsOf(sectionId: string) {
  return state.artifact?.keyPoints.filter((kp) => kp.sectionId === sectionId) ?? []
}

export function outlineNodes(): OutlineNode[] {
  return state.artifact?.outline ?? []
}
