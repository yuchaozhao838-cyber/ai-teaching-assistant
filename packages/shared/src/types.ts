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
