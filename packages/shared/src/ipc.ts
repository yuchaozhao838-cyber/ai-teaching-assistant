/**
 * 渲染进程可用的 IPC API 形状（preload 通过 contextBridge 暴露为 window.tutor）。
 * 该接口同时约束主进程 handler 与前端调用，避免通道名漂移。
 */
import type {
  AppSettings,
  DocumentRecord,
  ExportFormat,
  ExportResult,
  LessonArtifact,
  LessonEvent,
  ProblemSet,
  ProviderConfig,
  VisionEvent,
  WebAttachment,
  WebIngestResult
} from './types'

export interface ProviderUpdate {
  id?: string
  name: string
  kind: ProviderConfig['kind']
  baseUrl: string
  model: string
  temperature: number
  /** 传 undefined 表示不修改；传 '' 表示清除密钥 */
  apiKey?: string
}

export interface TestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface CaptureState {
  open: boolean
  url: string
  title: string
}

export interface GenerateProblemsPayload {
  documentId?: string
  topic?: string
  mode: 'create' | 'extract'
  count: number
  difficulty: 'mixed' | 'easy' | 'medium' | 'hard'
  types: Array<'choice' | 'fill' | 'calc' | 'proof' | 'short'>
  title?: string
}

export interface TutorApi {
  app: {
    info(): Promise<{
      version: string
      platform: string
      dataDir: string
      electron: string
      chrome: string
    }>
    openDataDir(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  docs: {
    list(): Promise<DocumentRecord[]>
    get(id: string): Promise<DocumentRecord | null>
    importFiles(): Promise<{ ok: boolean; canceled?: boolean; documents: DocumentRecord[]; errors: string[] }>
    importText(title: string, text: string): Promise<{ ok: boolean; document?: DocumentRecord; error?: string }>
    importWeb(url: string): Promise<{ ok: boolean; document?: DocumentRecord; result?: WebIngestResult; error?: string }>
    /** PDF 识图导入：逐页渲染 + 视觉模型转写（公式保真） */
    importVisionPdf(): Promise<{ ok: boolean; canceled?: boolean; documents?: DocumentRecord[]; errors?: string[]; error?: string }>
    onVisionEvent(cb: (event: VisionEvent) => void): () => void
    remove(id: string): Promise<void>
  }
  /** 可登录的实时抓取：打开真实浏览窗口，用户登录/翻页后抓取当前页 */
  web: {
    openCapture(url: string): Promise<{ ok: boolean; error?: string }>
    captureState(): Promise<CaptureState>
    captureCurrent(): Promise<{ ok: boolean; document?: DocumentRecord; attachments?: WebAttachment[]; error?: string }>
    downloadAttachments(items: WebAttachment[]): Promise<{ ok: boolean; documents: DocumentRecord[]; errors: string[] }>
    closeCapture(): Promise<void>
  }
  /** 习题练习：生成题目 + 详解，也可自己出题（不强制作答） */
  practice: {
    list(): Promise<ProblemSet[]>
    get(id: string): Promise<ProblemSet | null>
    generate(input: GenerateProblemsPayload): Promise<{ ok: boolean; set?: ProblemSet; warnings?: string[]; error?: string }>
    createManual(title: string): Promise<{ ok: boolean; set?: ProblemSet; error?: string }>
    update(set: ProblemSet): Promise<{ ok: boolean; set?: ProblemSet; error?: string }>
    remove(id: string): Promise<void>
  }
  lesson: {
    list(): Promise<LessonArtifact[]>
    get(id: string): Promise<LessonArtifact | null>
    generate(documentId: string): Promise<{ ok: boolean; artifactId?: string; error?: string }>
    regenerateSection(artifactId: string, sectionId: string): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
    updateSection(artifactId: string, sectionId: string, markdown: string): Promise<{ ok: boolean; error?: string }>
    updateKeyPoint(artifactId: string, keyPointId: string, text: string, level: string): Promise<{ ok: boolean }>
    remove(id: string): Promise<void>
    onEvent(cb: (e: LessonEvent) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    saveProvider(p: ProviderUpdate): Promise<AppSettings>
    removeProvider(id: string): Promise<AppSettings>
    setActive(id: string): Promise<AppSettings>
    test(p: ProviderUpdate): Promise<TestResult>
  }
  exporter: {
    run(artifactId: string, format: ExportFormat): Promise<ExportResult>
  }
}

declare global {
  interface Window {
    tutor: TutorApi
  }
}
