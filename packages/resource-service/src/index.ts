import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppSettings, DocumentRecord, LessonArtifact, ProblemSet, ProviderConfig } from '@tutor/shared'
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
