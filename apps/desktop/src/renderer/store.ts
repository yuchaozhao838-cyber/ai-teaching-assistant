import { reactive } from 'vue'
import { isDateKey } from '@tutor/study'
import type {
  AppSettings,
  CalendarEvent,
  CourseSlot,
  DailyQuote,
  TimetableMeta,
  TimetableMapping,
  DocumentRecord,
  ExportFormat,
  ExportResult,
  FocusPreset,
  FocusSession,
  HomeworkRule,
  IdeaNote,
  IdeaPolishMode,
  PrepGenerateInput,
  PrepGoal,
  LessonArtifact,
  LessonEvent,
  LessonPhase,
  MistakeItem,
  OutlineNode,
  StudyEvent,
  ProblemSet,
  ProviderUpdate,
  StudyStats,
  TestResult
} from '@tutor/shared'

export type ViewKey = 'library' | 'lesson' | 'practice' | 'prep' | 'focus' | 'ideas' | 'settings'

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
  /* 学习管理 */
  studyStats: null as StudyStats | null,
  studyQuote: null as DailyQuote | null,
  focusPresets: [] as FocusPreset[],
  focusSessions: [] as FocusSession[],
  mistakes: [] as MistakeItem[],
  studyEvents: [] as StudyEvent[],
  calendarEvents: [] as CalendarEvent[],
  homeworkRules: [] as HomeworkRule[],
  courseSlots: [] as CourseSlot[],
  ideas: [] as IdeaNote[],
  prepGoals: [] as PrepGoal[],
  timetableMeta: null as TimetableMeta | null,
  focusTab: 'timer' as 'timer' | 'calendar' | 'timetable',
  /** 迷你窗口模式（番茄钟置顶小窗） */
  mini: false,
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

/* -------------------------------- 学习管理 -------------------------------- */

function sanitizeTimetableMeta(meta: TimetableMeta | null): TimetableMeta | null {
  if (!meta) return null
  const clean: TimetableMeta = { ...meta }
  if (clean.termStart && !isDateKey(clean.termStart)) delete clean.termStart
  if (!Number.isFinite(clean.week) || (clean.week ?? 0) < 1) delete clean.week
  if (!Number.isFinite(clean.viewWeek) || (clean.viewWeek ?? 0) < 1) delete clean.viewWeek
  if (clean.vacations) {
    const vacations = clean.vacations.filter((item) => isDateKey(item.start) && isDateKey(item.end))
    if (vacations.length) clean.vacations = vacations
    else delete clean.vacations
  }
  return clean
}

export async function loadStudy() {
  const [stats, quote, presets, sessions, mistakes, events, calendarEvents, homeworkRules, courseSlots, timetableMeta] = await Promise.all([
    window.tutor.study.stats(),
    window.tutor.study.quote(),
    window.tutor.focus.presets(),
    window.tutor.focus.sessions(),
    window.tutor.mistakes.list(),
    window.tutor.study.events(),
    window.tutor.calendar.events(),
    window.tutor.calendar.rules(),
    window.tutor.timetable.list(),
    window.tutor.timetable.meta()
  ])
  state.studyStats = stats
  state.studyQuote = quote
  state.focusPresets = presets
  state.focusSessions = sessions
  state.mistakes = mistakes
  state.studyEvents = events
  state.calendarEvents = calendarEvents
  state.homeworkRules = homeworkRules
  state.courseSlots = courseSlots
  state.timetableMeta = sanitizeTimetableMeta(timetableMeta)
}

/* -------------------------------- 备考规划 -------------------------------- */

export async function loadPrep() {
  state.prepGoals = await window.tutor.prep.list()
}

export async function savePrepGoal(goal: PrepGoal) {
  const saved = await window.tutor.prep.save(toPlain(goal) as PrepGoal)
  state.prepGoals = state.prepGoals.some((item) => item.id === saved.id)
    ? state.prepGoals.map((item) => (item.id === saved.id ? saved : item))
    : [saved, ...state.prepGoals]
  return saved
}

export async function removePrepGoal(id: string) {
  await window.tutor.prep.remove(id)
  state.prepGoals = state.prepGoals.filter((item) => item.id !== id)
}

export async function generatePrep(input: PrepGenerateInput) {
  const result = await window.tutor.prep.generate(toPlain(input) as PrepGenerateInput)
  if (result.ok && result.goal) {
    state.prepGoals = [result.goal, ...state.prepGoals.filter((item) => item.id !== result.goal!.id)]
  }
  return result
}

export async function advisePrep(goalId: string) {
  return window.tutor.prep.advise(goalId)
}

export function goPrep() {
  state.view = 'prep'
}

/* -------------------------------- 灵感记录 -------------------------------- */

export async function loadIdeas() {
  state.ideas = await window.tutor.ideas.list()
}

export async function saveIdea(idea: IdeaNote) {
  const saved = await window.tutor.ideas.save(toPlain(idea) as IdeaNote)
  state.ideas = state.ideas.some((item) => item.id === saved.id)
    ? state.ideas.map((item) => (item.id === saved.id ? saved : item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [saved, ...state.ideas]
  return saved
}

export async function removeIdea(id: string) {
  await window.tutor.ideas.remove(id)
  state.ideas = state.ideas.filter((item) => item.id !== id)
}

export async function polishIdea(input: { text: string; mode: IdeaPolishMode; title?: string }) {
  return window.tutor.ideas.polish(toPlain(input))
}

export function goIdeas() {
  state.view = 'ideas'
}

/* -------------------------------- 课表 -------------------------------- */

export async function saveCourseSlots(slots: CourseSlot[]) {
  state.courseSlots = await window.tutor.timetable.save(toPlain(slots))
  return state.courseSlots
}

export async function saveTimetableMetaPatch(patch: Partial<TimetableMeta>) {
  const base: TimetableMeta = state.timetableMeta ?? { updatedAt: new Date().toISOString() }
  state.timetableMeta = await window.tutor.timetable.saveMeta(
    toPlain({ ...base, ...patch, updatedAt: new Date().toISOString() })
  )
  return state.timetableMeta
}

export async function saveTimetableWeek(viewWeek: number) {
  const base = state.timetableMeta ?? { week: viewWeek, updatedAt: new Date().toISOString() }
  state.timetableMeta = await window.tutor.timetable.saveMeta(
    toPlain({ ...base, viewWeek, updatedAt: new Date().toISOString() })
  )
  return state.timetableMeta
}

export async function importTimetableCsv(text: string) {
  return window.tutor.timetable.importCsv(text)
}

export async function openCrawler(url: string) {
  return window.tutor.timetable.openCrawler(url)
}

export async function captureTimetable() {
  const result = await window.tutor.timetable.capture()
  if (result.ok) {
    state.courseSlots = await window.tutor.timetable.list()
  }
  return result
}

export async function applyTimetableMapping(candidateId: string, mapping: TimetableMapping) {
  const result = await window.tutor.timetable.applyMapping(candidateId, toPlain(mapping))
  if (result.ok) {
    state.courseSlots = await window.tutor.timetable.list()
  }
  return result
}

export async function exportTimetableDiagnostics() {
  const result = await window.tutor.timetable.diagnostics()
  if (result.ok && typeof document !== 'undefined') {
    const blob = new Blob([result.text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '课表抓取诊断.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
  return result
}

export async function closeCrawler() {
  await window.tutor.timetable.closeCrawler()
}

/* -------------------------------- 日历 -------------------------------- */

export async function saveCalendarEvent(event: CalendarEvent) {
  const saved = await window.tutor.calendar.saveEvent(toPlain(event))
  state.calendarEvents = state.calendarEvents.some((item) => item.id === saved.id)
    ? state.calendarEvents.map((item) => (item.id === saved.id ? saved : item))
    : [...state.calendarEvents, saved]
  return saved
}

export async function removeCalendarEvent(id: string) {
  await window.tutor.calendar.removeEvent(id)
  state.calendarEvents = state.calendarEvents.filter((item) => item.id !== id)
}

export async function saveHomeworkRule(rule: HomeworkRule) {
  state.homeworkRules = await window.tutor.calendar.saveRule(toPlain(rule))
  return state.homeworkRules
}

export async function removeHomeworkRule(id: string) {
  state.homeworkRules = await window.tutor.calendar.removeRule(id)
  return state.homeworkRules
}

export async function importIcs(text: string) {
  const result = await window.tutor.calendar.importIcs(text)
  if (result.ok) {
    state.calendarEvents = await window.tutor.calendar.events()
  }
  return result
}

export async function exportIcs() {
  const result = await window.tutor.calendar.exportIcs()
  if (result.ok && typeof document !== 'undefined') {
    const blob = new Blob([result.text], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'ai-tutor-calendar.ics'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
  return result
}

export async function refreshStudyStats() {
  state.studyStats = await window.tutor.study.stats()
}

export async function finishFocusSession(session: Omit<FocusSession, 'id'>) {
  const result = await window.tutor.focus.finish(toPlain(session) as Omit<FocusSession, 'id'>)
  state.focusSessions = [result.session, ...state.focusSessions]
  await refreshStudyStats()
  return result
}

export async function saveFocusPreset(preset: FocusPreset) {
  state.focusPresets = await window.tutor.focus.savePreset(toPlain(preset))
  return state.focusPresets
}

export async function removeFocusPreset(id: string) {
  state.focusPresets = await window.tutor.focus.removePreset(id)
  return state.focusPresets
}

export async function addMistakes(items: Array<Partial<MistakeItem>>) {
  const saved = await window.tutor.mistakes.add(toPlain(items))
  state.mistakes = [...saved, ...state.mistakes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return saved
}

export async function updateMistake(id: string, patch: Partial<MistakeItem>) {
  const saved = await window.tutor.mistakes.update(id, toPlain(patch))
  if (saved) {
    state.mistakes = state.mistakes.map((item) => (item.id === id ? saved : item))
  }
  return saved
}

export async function removeMistake(id: string) {
  await window.tutor.mistakes.remove(id)
  state.mistakes = state.mistakes.filter((item) => item.id !== id)
}

export async function clearMasteredMistakes() {
  await window.tutor.mistakes.clearMastered()
  state.mistakes = state.mistakes.filter((item) => item.status !== 'mastered')
}

export function goFocus() {
  state.view = 'focus'
}

/** 切换迷你窗口（番茄钟置顶小窗） */
export async function setMini(enabled: boolean) {
  try {
    await window.tutor.app.setMiniWindow(enabled)
  } catch {
    /* 手机版没有窗口概念，忽略 */
  }
  state.mini = enabled
  if (enabled) state.view = 'focus'
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

    // 学习管理数据（番茄钟统计 / 语录 / 错题本）：失败也不影响主流程
    try {
      await loadStudy()
    } catch {
      /* ignore */
    }

    try {
      await loadIdeas()
    } catch {
      /* ignore */
    }

    try {
      await loadPrep()
    } catch {
      /* ignore */
    }

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
