import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  IdeaNote,
  CalendarEvent,
  CourseSlot,
  DocumentRecord,
  FocusPreset,
  FocusSession,
  HomeworkRule,
  LessonArtifact,
  MistakeItem,
  ProblemSet,
  PrepGoal,
  ProviderConfig,
  StudyEvent,
  TimetableMeta
} from '@tutor/shared'
import { PROVIDER_PRESETS } from '@tutor/shared'

export interface SecretStore {
  get(providerId: string): string | null
  set(providerId: string, value: string): void
  remove(providerId: string): void
}

export interface ResourceService {
  readonly dataDir: string
  listDocuments(): Promise<DocumentRecord[]>
  getDocument(id: string): Promise<DocumentRecord | null>
  saveDocument(doc: DocumentRecord): Promise<DocumentRecord>
  deleteDocument(id: string): Promise<void>
  listArtifacts(): Promise<LessonArtifact[]>
  getArtifact(id: string): Promise<LessonArtifact | null>
  getArtifactByDocument(documentId: string): Promise<LessonArtifact | null>
  saveArtifact(artifact: LessonArtifact): Promise<LessonArtifact>
  deleteArtifact(id: string): Promise<void>
  listProblemSets(): Promise<ProblemSet[]>
  getProblemSet(id: string): Promise<ProblemSet | null>
  saveProblemSet(set: ProblemSet): Promise<ProblemSet>
  deleteProblemSet(id: string): Promise<void>
  /* 学习管理：时间轴 / 番茄钟 / 错题本 */
  listStudyEvents(): Promise<StudyEvent[]>
  saveStudyEvent(event: StudyEvent): Promise<StudyEvent>
  deleteStudyEvent(id: string): Promise<void>
  listFocusSessions(): Promise<FocusSession[]>
  saveFocusSession(session: FocusSession): Promise<FocusSession>
  getFocusPresets(): Promise<FocusPreset[]>
  saveFocusPresets(presets: FocusPreset[]): Promise<FocusPreset[]>
  listMistakes(): Promise<MistakeItem[]>
  saveMistake(item: MistakeItem): Promise<MistakeItem>
  deleteMistake(id: string): Promise<void>
  listCalendarEvents(): Promise<CalendarEvent[]>
  saveCalendarEvent(event: CalendarEvent): Promise<CalendarEvent>
  deleteCalendarEvent(id: string): Promise<void>
  listHomeworkRules(): Promise<HomeworkRule[]>
  saveHomeworkRules(rules: HomeworkRule[]): Promise<HomeworkRule[]>
  listCourseSlots(): Promise<CourseSlot[]>
  saveCourseSlots(slots: CourseSlot[]): Promise<CourseSlot[]>
  listPrepGoals(): Promise<PrepGoal[]>
  savePrepGoal(goal: PrepGoal): Promise<PrepGoal>
  deletePrepGoal(id: string): Promise<void>
  listIdeas(): Promise<IdeaNote[]>
  saveIdea(idea: IdeaNote): Promise<IdeaNote>
  deleteIdea(id: string): Promise<void>
  getTimetableMeta(): Promise<TimetableMeta | null>
  saveTimetableMeta(meta: TimetableMeta): Promise<TimetableMeta>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
}

/** 极简原子 JSON 存储：写临时文件后 rename，避免进程中断导致文件损坏 */
class JsonFile<T> {
  private cache: T | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly fallback: () => T) {}

  async read(): Promise<T> {
    if (this.cache !== null) return this.cache
    try {
      const text = await fs.readFile(this.file, 'utf8')
      this.cache = JSON.parse(text) as T
    } catch {
      this.cache = this.fallback()
    }
    return this.cache
  }

  async write(value: T): Promise<void> {
    this.cache = value
    const snapshot = JSON.stringify(value, null, 2)
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, this.file)
    })
    return this.writing
  }
}

function defaultSettings(): AppSettings {
  const demo = PROVIDER_PRESETS.find((p) => p.id === 'demo')!
  const providers: ProviderConfig[] = [
    {
      id: demo.id,
      name: demo.name,
      kind: demo.kind,
      baseUrl: demo.baseUrl,
      model: demo.model,
      temperature: 0.6,
      hasKey: true
    }
  ]
  return { activeProviderId: demo.id, providers, useChunkSummary: true }
}

export function normalizeSettings(settings: AppSettings, secrets: SecretStore): AppSettings {
  const providers = (settings.providers ?? []).map((p) => ({
    ...p,
    temperature: Number.isFinite(p.temperature) ? p.temperature : 0.6,
    hasKey: p.kind === 'demo' ? true : Boolean(secrets.get(p.id))
  }))
  if (!providers.length) return defaultSettings()
  const activeProviderId = providers.some((p) => p.id === settings.activeProviderId)
    ? settings.activeProviderId
    : providers[0].id
  return { ...settings, providers, activeProviderId, useChunkSummary: settings.useChunkSummary ?? true }
}

export function createLocalResourceService(options: { dataDir: string; secrets: SecretStore }): ResourceService {
  const { dataDir, secrets } = options
  const documentsFile = new JsonFile<DocumentRecord[]>(path.join(dataDir, 'documents.json'), () => [])
  const artifactsFile = new JsonFile<LessonArtifact[]>(path.join(dataDir, 'artifacts.json'), () => [])
  const problemSetsFile = new JsonFile<ProblemSet[]>(path.join(dataDir, 'problem-sets.json'), () => [])
  const studyEventsFile = new JsonFile<StudyEvent[]>(path.join(dataDir, 'study-events.json'), () => [])
  const focusSessionsFile = new JsonFile<FocusSession[]>(path.join(dataDir, 'focus-sessions.json'), () => [])
  const focusPresetsFile = new JsonFile<FocusPreset[]>(path.join(dataDir, 'focus-presets.json'), () => [])
  const mistakesFile = new JsonFile<MistakeItem[]>(path.join(dataDir, 'mistakes.json'), () => [])
  const calendarFile = new JsonFile<CalendarEvent[]>(path.join(dataDir, 'calendar-events.json'), () => [])
  const homeworkRulesFile = new JsonFile<HomeworkRule[]>(path.join(dataDir, 'homework-rules.json'), () => [])
  const timetableFile = new JsonFile<CourseSlot[]>(path.join(dataDir, 'timetable.json'), () => [])
  const timetableMetaFile = new JsonFile<TimetableMeta | null>(path.join(dataDir, 'timetable-meta.json'), () => null)
  const ideasFile = new JsonFile<IdeaNote[]>(path.join(dataDir, 'ideas.json'), () => [])
  const prepFile = new JsonFile<PrepGoal[]>(path.join(dataDir, 'prep-goals.json'), () => [])
  const settingsFile = new JsonFile<AppSettings>(path.join(dataDir, 'settings.json'), defaultSettings)

  return {
    dataDir,

    async listDocuments() {
      const docs = await documentsFile.read()
      return [...docs].sort((a, b) => b.createdAt - a.createdAt)
    },

    async getDocument(id) {
      const docs = await documentsFile.read()
      return docs.find((d) => d.id === id) ?? null
    },

    async saveDocument(doc) {
      const docs = await documentsFile.read()
      const index = docs.findIndex((d) => d.id === doc.id)
      if (index >= 0) docs[index] = doc
      else docs.push(doc)
      await documentsFile.write(docs)
      return doc
    },

    async deleteDocument(id) {
      const docs = await documentsFile.read()
      const next = docs.filter((d) => d.id !== id)
      await documentsFile.write(next)
      const artifacts = await artifactsFile.read()
      const remaining = artifacts.filter((a) => a.documentId !== id)
      if (remaining.length !== artifacts.length) await artifactsFile.write(remaining)
    },

    async listArtifacts() {
      const artifacts = await artifactsFile.read()
      return [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async getArtifact(id) {
      const artifacts = await artifactsFile.read()
      return artifacts.find((a) => a.id === id) ?? null
    },

    async getArtifactByDocument(documentId) {
      const artifacts = await artifactsFile.read()
      return artifacts.filter((a) => a.documentId === documentId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    },

    async saveArtifact(artifact) {
      const artifacts = await artifactsFile.read()
      const index = artifacts.findIndex((a) => a.id === artifact.id)
      if (index >= 0) artifacts[index] = artifact
      else artifacts.push(artifact)
      await artifactsFile.write(artifacts)
      return artifact
    },

    async deleteArtifact(id) {
      const artifacts = await artifactsFile.read()
      await artifactsFile.write(artifacts.filter((a) => a.id !== id))
    },

    async listProblemSets() {
      const sets = await problemSetsFile.read()
      return [...sets].sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async getProblemSet(id) {
      const sets = await problemSetsFile.read()
      return sets.find((s) => s.id === id) ?? null
    },

    async saveProblemSet(set) {
      const sets = await problemSetsFile.read()
      const index = sets.findIndex((s) => s.id === set.id)
      if (index >= 0) sets[index] = set
      else sets.push(set)
      await problemSetsFile.write(sets)
      return set
    },

    async deleteProblemSet(id) {
      const sets = await problemSetsFile.read()
      await problemSetsFile.write(sets.filter((s) => s.id !== id))
    },

    async listStudyEvents() {
      const events = await studyEventsFile.read()
      return [...events].sort((a, b) => b.startAt.localeCompare(a.startAt))
    },

    async saveStudyEvent(event) {
      const events = await studyEventsFile.read()
      const index = events.findIndex((item) => item.id === event.id)
      if (index >= 0) events[index] = event
      else events.push(event)
      await studyEventsFile.write(events)
      return event
    },

    async deleteStudyEvent(id) {
      const events = await studyEventsFile.read()
      await studyEventsFile.write(events.filter((item) => item.id !== id))
    },

    async listFocusSessions() {
      const sessions = await focusSessionsFile.read()
      return [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },

    async saveFocusSession(session) {
      const sessions = await focusSessionsFile.read()
      const index = sessions.findIndex((item) => item.id === session.id)
      if (index >= 0) sessions[index] = session
      else sessions.push(session)
      await focusSessionsFile.write(sessions)
      return session
    },

    async getFocusPresets() {
      return focusPresetsFile.read()
    },

    async saveFocusPresets(presets) {
      await focusPresetsFile.write(presets)
      return presets
    },

    async listMistakes() {
      const items = await mistakesFile.read()
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async saveMistake(item) {
      const items = await mistakesFile.read()
      const index = items.findIndex((entry) => entry.id === item.id)
      if (index >= 0) items[index] = item
      else items.push(item)
      await mistakesFile.write(items)
      return item
    },

    async deleteMistake(id) {
      const items = await mistakesFile.read()
      await mistakesFile.write(items.filter((entry) => entry.id !== id))
    },

    async listCalendarEvents() {
      const events = await calendarFile.read()
      return [...events].sort((a, b) => `${a.date}${a.startTime ?? ''}`.localeCompare(`${b.date}${b.startTime ?? ''}`))
    },

    async saveCalendarEvent(event) {
      const events = await calendarFile.read()
      const index = events.findIndex((item) => item.id === event.id)
      if (index >= 0) events[index] = event
      else events.push(event)
      await calendarFile.write(events)
      return event
    },

    async deleteCalendarEvent(id) {
      const events = await calendarFile.read()
      await calendarFile.write(events.filter((item) => item.id !== id))
    },

    async listHomeworkRules() {
      return homeworkRulesFile.read()
    },

    async saveHomeworkRules(rules) {
      await homeworkRulesFile.write(rules)
      return rules
    },

    async listCourseSlots() {
      const slots = await timetableFile.read()
      return [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    },

    async saveCourseSlots(slots) {
      await timetableFile.write(slots)
      return slots
    },

    async listPrepGoals() {
      const goals = await prepFile.read()
      return [...goals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async savePrepGoal(goal) {
      const goals = await prepFile.read()
      const index = goals.findIndex((item) => item.id === goal.id)
      if (index >= 0) goals[index] = goal
      else goals.push(goal)
      await prepFile.write(goals)
      return goal
    },

    async deletePrepGoal(id) {
      const goals = await prepFile.read()
      await prepFile.write(goals.filter((item) => item.id !== id))
    },

    async listIdeas() {
      const ideas = await ideasFile.read()
      return [...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async saveIdea(idea) {
      const ideas = await ideasFile.read()
      const index = ideas.findIndex((item) => item.id === idea.id)
      if (index >= 0) ideas[index] = idea
      else ideas.push(idea)
      await ideasFile.write(ideas)
      return idea
    },

    async deleteIdea(id) {
      const ideas = await ideasFile.read()
      await ideasFile.write(ideas.filter((item) => item.id !== id))
    },

    async getTimetableMeta() {
      return timetableMetaFile.read()
    },

    async saveTimetableMeta(meta) {
      await timetableMetaFile.write(meta)
      return meta
    },

    async getSettings() {
      const settings = await settingsFile.read()
      return normalizeSettings(settings, secrets)
    },

    async saveSettings(settings) {
      const normalized = normalizeSettings(settings, secrets)
      await settingsFile.write(normalized)
      return normalized
    }
  }
}

export { defaultSettings }
