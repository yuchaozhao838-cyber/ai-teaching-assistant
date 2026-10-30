/**
 * @tutor/shared —— 全局共享类型（数据模型 / 事件 / 设置）
 * 数据模型严格对应设计文档第 5 节：Document、Block、LessonArtifact。
 */

export type SourceType = 'file' | 'web' | 'text' | 'kb'

export type BlockType = 'heading' | 'paragraph' | 'formula' | 'list' | 'table' | 'code' | 'image'

export interface Block {
  id: string
  type: BlockType
  /** 纯文本内容（heading/paragraph/list/table/code） */
  text?: string
  /** heading 级别 1-6 */
  level?: number
  /** formula 的 LaTeX 源码 */
  latex?: string
  /** image 的素材引用 */
  assetRef?: string
  /** list 是否有序 */
  ordered?: boolean
}

export interface DocumentMeta {
  fileName?: string
  ext?: string
  charCount: number
  blockCount: number
  chunkCount: number
  pageCount?: number
  /** 解析阶段产生的非致命提示，例如「部分公式无法识别」 */
  warnings: string[]
}

export interface DocumentRecord {
  id: string
  title: string
  sourceType: SourceType
  sourceUri?: string
  createdAt: number
  blocks: Block[]
  /** 由 blocks 展平的纯文本，用于提示词与检索 */
  plainText: string
  meta: DocumentMeta
}

export type KeyPointLevel = 'high' | 'medium' | 'low'

export interface OutlineNode {
  id: string
  title: string
  summary: string
  /** 该节最容易被误解/最需强调的一句话（模型可选提供） */
  hint?: string
  children: OutlineNode[]
}

export interface ExplanationSection {
  sectionId: string
  markdown: string
  updatedAt: number
  model?: string
  /** 用户手动编辑过，重新生成时应提示覆盖 */
  manual?: boolean
}

export interface KeyPoint {
  id: string
  sectionId: string
  level: KeyPointLevel
  text: string
  rationale?: string
}

export type ArtifactStatus = 'generating' | 'done' | 'partial' | 'failed'

export interface LessonArtifact {
  id: string
  documentId: string
  documentTitle: string
  providerId: string
  providerName: string
  model: string
  promptVersion: string
  createdAt: number
  updatedAt: number
  status: ArtifactStatus
  outline: OutlineNode[]
  explanations: ExplanationSection[]
  keyPoints: KeyPoint[]
  error?: string
  warnings: string[]
  stats?: {
    sections: number
    chars: number
    elapsedMs: number
    mocked: boolean
  }
}

/* ---------------------------------- 设置 ---------------------------------- */

export type ProviderKind = 'openai' | 'demo'

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  temperature: number
  /** 是否已在本机保存过密钥（密钥本身经 safeStorage 加密，永不回传前端） */
  hasKey: boolean
}

export interface AppSettings {
  activeProviderId: string
  providers: ProviderConfig[]
  /** 生成时是否优先使用原文分块摘要（长文档） */
  useChunkSummary: boolean
}

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  note: string
}

/* ---------------------------------- 事件 ---------------------------------- */

export type LessonPhase =
  | 'prepare'
  | 'chunking'
  | 'outline'
  | 'explain'
  | 'keypoints'
  | 'persist'
  | 'done'
  | 'failed'

export type LessonEvent =
  | {
      type: 'progress'
      artifactId: string
      phase: LessonPhase
      message: string
      current?: number
      total?: number
      title?: string
    }
  | { type: 'outline'; artifactId: string; outline: OutlineNode[] }
  | { type: 'delta'; artifactId: string; sectionId: string; chunk: string }
  | { type: 'section'; artifactId: string; sectionId: string; markdown: string; model?: string }
  | { type: 'keypoints'; artifactId: string; keyPoints: KeyPoint[] }
  | { type: 'done'; artifactId: string; ok: boolean; error?: string; artifact?: LessonArtifact }
  | { type: 'log'; artifactId: string; message: string }

export type ExportFormat = 'docx' | 'pptx' | 'pdf' | 'md'

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

/* -------------------------------- 习题练习 -------------------------------- */

export type ProblemType = 'choice' | 'fill' | 'calc' | 'proof' | 'short'
export type ProblemDifficulty = 'easy' | 'medium' | 'hard'
export type ProblemOrigin = 'ai' | 'manual' | 'extracted'
/** create=根据材料出新题；extract=整理材料里已有的题目并补解析；manual=自己录入 */
export type ProblemMode = 'create' | 'extract' | 'manual'

export interface ProblemItem {
  id: string
  type: ProblemType
  difficulty: ProblemDifficulty
  stem: string
  /** 选择题的选项（A/B/C/D 由前端渲染序号） */
  options: string[]
  answer: string
  /** 逐步解析；观看时才展开，不强制作答 */
  explanation: string
  sectionTitle?: string
  origin: ProblemOrigin
  /** 材料里的原句依据（用于核对题目没有跑题） */
  sourceQuote?: string
}

export interface ProblemSet {
  id: string
  title: string
  mode: ProblemMode
  documentId?: string
  documentTitle?: string
  topic?: string
  providerId?: string
  providerName?: string
  model?: string
  createdAt: number
  updatedAt: number
  items: ProblemItem[]
  warnings: string[]
}

/* -------------------------------- 导入/解析 -------------------------------- */

export interface IngestFileResult {
  title: string
  blocks: Block[]
  ext: string
  warnings: string[]
  pageCount?: number
}

export interface WebIngestResult {
  title: string
  url: string
  blocks: Block[]
  warnings: string[]
}

/** 页面里可下载的附件（PDF / PPT / Word 等），用抓取窗口的登录态下载 */
export interface WebAttachment {
  url: string
  name: string
}

/** PDF 识图导入的进度事件 */
export type VisionEvent =
  | {
      type: 'progress'
      file: string
      phase: 'render' | 'transcribe'
      message: string
      current?: number
      total?: number
    }
  | { type: 'done'; ok: boolean; documents: Array<{ id: string; title: string }>; errors: string[] }

/* ---------------------------- 学习管理（v2）---------------------------- */

/** 统一时间轴：番茄钟/练习/复习都写这个，日历与统计都读这个 */
export type StudyKind = 'focus' | 'quiz' | 'exam' | 'lab' | 'homework' | 'review'

export interface StudyEvent {
  id: string
  /** YYYY-MM-DD（本地时区），方便按天聚合 */
  date: string
  startAt: string
  endAt: string
  minutes: number
  kind: StudyKind
  refId?: string
  title?: string
}

export type FocusMode = 'focus' | 'shortBreak' | 'longBreak'

export interface FocusPreset {
  id: string
  name: string
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  pomodorosPerLongBreak: number
  autoStartNext: boolean
}

export interface FocusTaskRef {
  type: 'document' | 'problemSet' | 'lesson'
  id: string
  title?: string
}

export interface FocusSession {
  id: string
  mode: FocusMode
  presetId?: string
  plannedMinutes: number
  startedAt: string
  endedAt: string
  pausedMinutes: number
  actualMinutes: number
  completed: boolean
  taskRef?: FocusTaskRef
}

export interface StudyStats {
  today: { focusCount: number; focusMinutes: number }
  week: { focusCount: number; focusMinutes: number; activeDays: number }
  streakDays: number
  last7Days: Array<{ date: string; minutes: number; count: number }>
}

export type MistakeSource = 'quiz' | 'manual'
export type MistakeStatus = 'learning' | 'mastered'
export type MistakeType = 'single' | 'multiple' | 'blank' | 'short'

export interface MistakeItem {
  id: string
  source: MistakeSource
  courseId?: string
  knowledgePoint?: string
  type: MistakeType
  stem: string
  options?: string[]
  answer: string
  explanation: string
  /** 自动收集时记下当时选错的答案 */
  wrongAnswer?: string
  status: MistakeStatus
  reviewCount: number
  lastReviewedAt?: string
  createdAt: string
  /** 回溯用：来自哪个题集的哪道题 */
  problemSetId?: string
  problemId?: string
}

/** 备考目标：AI 出阶段计划 + 每周任务 */
export type PrepTaskKind = 'read' | 'practice' | 'review' | 'mock' | 'listen' | 'write' | 'vocab'

export interface PrepTask {
  id: string
  title: string
  kind: PrepTaskKind
  /** 第几周（相对目标开始，1 起） */
  week: number
  minutes: number
  done: boolean
  materialId?: string
}

export interface PrepPhase {
  id: string
  name: string
  weekFrom: number
  weekTo: number
  focus: string
  tasks: PrepTask[]
}

export interface PrepGenerateInput {
  title: string
  examName: string
  examDate?: string
  weeks: number
  dailyMinutes: number
  baseline?: string
  targetScore?: string
  materialIds: string[]
}

export interface PrepGoal {
  id: string
  title: string
  examName: string
  examDate?: string
  startDate: string
  weeks: number
  dailyMinutes: number
  baseline?: string
  targetScore?: string
  materialIds: string[]
  summary?: string
  advice: string[]
  phases: PrepPhase[]
  createdAt: string
  updatedAt: string
}

/** 灵感记录：随手记 + AI 润色 + 导出 */
export interface IdeaNote {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  /** 来源：quick=快速记录，manual=手动新建 */
  source?: 'quick' | 'manual'
  /** 关联材料/题集（可选） */
  refId?: string
}

export type IdeaPolishMode = 'polish' | 'outline' | 'title'

export interface DailyQuote {
  text: string
  /** 出处（古代典籍/名人时才有） */
  author?: string
  /** 分类：行动 / 实话 / 视角 / 自嘲 / 陪伴 / 常识 */
  tag?: string
}

/* ------------------------------- 日历与课表 ------------------------------- */

export type CalendarEventType = 'study' | 'exam' | 'deadline' | 'custom'

export interface CalendarEvent {
  id: string
  title: string
  /** YYYY-MM-DD（本地时区） */
  date: string
  /** HH:mm；全天事件为空 */
  startTime?: string
  endTime?: string
  allDay: boolean
  type: CalendarEventType
  note?: string
  source: 'app' | 'system' | 'rule'
  externalId?: string
  createdAt: string
}

/** 作业周期规则：一次录入，每周自动生成"布置 / 截止"两条日程 */
export interface HomeworkRule {
  id: string
  courseName: string
  assignWeekday: 1 | 2 | 3 | 4 | 5 | 6 | 7
  assignTime: string
  submitDurationDays: number
  startDate: string
  endDate: string
  active: boolean
}

/** 放假区间 */
export interface VacationRange {
  start: string
  end: string
  name?: string
}

/** 教学周设置：以「第 1 周周一」为锚点，按日历自动推进 */
export interface TimetableMeta {
  /** 兼容旧数据：抓取到的当前周（termStart 缺失时兜底） */
  week?: number
  /** 用户正在查看的周 */
  viewWeek?: number
  termName?: string
  /** 第 1 周周一的 YYYY-MM-DD */
  termStart?: string
  /** 学期总周数（默认 18） */
  totalWeeks?: number
  /** 考试周区间（如 17-18） */
  examWeekStart?: number
  examWeekEnd?: number
  /** 放假区间列表 */
  vacations?: VacationRange[]
  updatedAt: string
}

/** 抓取到的接口候选：给"字段映射"兜底用 */
export interface JsonCandidate {
  id: string
  url: string
  count: number
  keys: string[]
  sample: Record<string, string>
}

/** 字段映射：让用户自己指定哪个字段是课程/星期/时间 */
export interface TimetableMapping {
  nameKey: string
  weekdayKey: string
  startKey?: string
  endKey?: string
  locationKey?: string
  teacherKey?: string
}

/** 课表条目（本周视图用；抓取或手动导入） */
export interface CourseSlot {
  id: string
  courseName: string
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7
  startTime: string
  endTime: string
  location?: string
  teacher?: string
  weeks?: string
  color?: string
  source: 'manual' | 'import' | 'crawl'
}

export interface Chunk {
  id: string
  index: number
  text: string
  blockIds: string[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'demo',
    name: '本地演示模型',
    kind: 'demo',
    baseUrl: '',
    model: 'demo-tutor',
    note: '无需 API Key，用内置模板与启发式规则生成讲解，便于先体验完整流程'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: 'OpenAI 兼容协议，性价比高，推荐国内学生使用'
  },
  {
    id: 'dashscope',
    name: '通义千问（阿里云百炼）',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    note: '使用 DashScope 的 OpenAI 兼容模式'
  },
  {
    id: 'huaweicloud',
    name: '华为云 MaaS',
    kind: 'openai',
    baseUrl: 'https://api.modelarts-maas.com/v1',
    model: 'deepseek-v3',
    note: '若控制台给出的接口地址不同，请直接修改下方 Base URL'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '需可访问 api.openai.com 的网络环境'
  }
]
