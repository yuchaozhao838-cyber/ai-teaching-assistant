/**
 * 生成 UI 预览副本：在 out/renderer 下写 mock-tutor.js + preview.html，
 * 用假数据把界面跑起来（无需 Electron），再用无头浏览器截图检查。
 * 运行：node scripts/make-preview.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'apps', 'desktop', 'out', 'renderer')

const markdown1 = `### 一句话结论

导数是**瞬时变化率**，几何上是曲线在该点的切线斜率。

设 $y=f(x)$，则

$$f'(x_0)=\\lim_{\\Delta x \\to 0}\\frac{f(x_0+\\Delta x)-f(x_0)}{\\Delta x}$$

### 为什么是"极限"

平均变化率 $\\frac{\\Delta y}{\\Delta x}$ 反映的是一段区间上的整体变化；把 $\\Delta x$ 不断缩小，
割线逐渐逼近切线，极限值才刻画"某一点"的瞬时状态。这一步从"平均"到"瞬时"的跨越，正是导数概念的难点。

| 概念 | 几何意义 | 表达式 |
| --- | --- | --- |
| 平均变化率 | 割线斜率 | $\\frac{\\Delta y}{\\Delta x}$ |
| 瞬时变化率 | 切线斜率 | $\\lim_{\\Delta x \\to 0}\\frac{\\Delta y}{\\Delta x}$ |

> ⚠ 易错点：可导必连续，但连续不一定可导。例如 $y=|x|$ 在 $x=0$ 处连续，左导数为 $-1$、右导数为 $1$，故不可导。

### 一个具体例子

以自由落体 $s(t)=\\frac{1}{2}gt^2$ 为例，$s'(t)=gt$ 就是时刻 $t$ 的瞬时速度——这就把"位置函数"和"速度"联系了起来。`

const markdown2 = `### 四则运算法则

若 $u(x)$、$v(x)$ 在 $x$ 处可导，则

1. $(u \\pm v)' = u' \\pm v'$
2. $(uv)' = u'v + uv'$
3. $\\left(\\dfrac{u}{v}\\right)' = \\dfrac{u'v - uv'}{v^2}\\ (v \\neq 0)$

### 链式法则

若 $y=f(u)$、$u=g(x)$，则

$$\\frac{dy}{dx}=f'(u)\\cdot g'(x)$$

\`\`\`text
例：y = sin(2x)，令 u = 2x，则 y' = cos(u)·2 = 2cos(2x)
\`\`\`

> ⚠ 易错点：链式法则最容易漏乘内层导数，写成 $\\cos(2x)$ 而不是 $2\\cos(2x)$。`

const markdown3 = `### 二阶导数的含义

二阶导数 $y''=\\dfrac{d^2y}{dx^2}$ 是"变化率的变化率"：

- $y''>0$：曲线凹口向上，速度在增加；
- $y''<0$：曲线凹口向下，速度在减小；
- $y''=0$ 且左右变号：可能是拐点。

### 微分与线性近似

微分定义为 $dy=f'(x)\\,dx$，它把函数增量中的线性主部单独拎出来：

$$f(x_0+\\Delta x)\\approx f(x_0)+f'(x_0)\\Delta x$$

> ⚠ 易错点：$dy$ 是线性主部，$\\Delta y - dy$ 是比 $\\Delta x$ 高阶的无穷小，二者并不相等。`

const artifact = {
  id: 'art_demo',
  documentId: 'doc_demo',
  documentTitle: '第三章 导数与微分',
  providerId: 'demo',
  providerName: '本地演示模型',
  model: 'demo-tutor',
  promptVersion: 'v1.0',
  createdAt: Date.now() - 1000 * 60 * 12,
  updatedAt: Date.now() - 1000 * 60 * 8,
  status: 'done',
  warnings: ['当前使用「本地演示模型」，讲解内容为规则生成，不代表真实教学质量'],
  stats: { sections: 3, chars: 2600, elapsedMs: 41_000, mocked: true },
  outline: [
    { id: 's1', title: '导数的定义与几何意义', summary: '从平均变化率过渡到瞬时变化率', children: [] },
    { id: 's2', title: '求导法则与链式法则', summary: '四则运算与复合函数的求导', children: [] },
    { id: 's3', title: '高阶导数与微分', summary: '凹凸性与线性近似', children: [] }
  ],
  explanations: [
    { sectionId: 's1', markdown: markdown1, updatedAt: Date.now(), model: 'demo-tutor' },
    { sectionId: 's2', markdown: markdown2, updatedAt: Date.now(), model: 'demo-tutor' },
    { sectionId: 's3', markdown: markdown3, updatedAt: Date.now(), model: 'demo-tutor', manual: true }
  ],
  keyPoints: [
    {
      id: 'k1',
      sectionId: 's1',
      level: 'high',
      text: '屏上偏移量 $y=\\frac{eU_d l}{mdv^2}\\left(\\frac{l}{2}+L\\right)$，故 $y\\propto U_d$',
      rationale: '解释电压如何变成几何位移，考试常考'
    },
    { id: 'k2', sectionId: 's1', level: 'medium', text: '导数的几何意义是切线斜率', rationale: '帮助建立直观' },
    { id: 'k3', sectionId: 's2', level: 'high', text: '链式法则：复合函数求导要乘以内层导数', rationale: '考试高频，最容易漏乘' },
    { id: 'k4', sectionId: 's2', level: 'medium', text: '商的求导法则分母要平方', rationale: '容易写错' },
    { id: 'k5', sectionId: 's3', level: 'low', text: '二阶导数反映曲线的凹凸性', rationale: '了解即可' }
  ]
}

const problemSets = [
  {
    id: 'pset_demo',
    title: '第三章 导数与微分 · 习题',
    mode: 'create',
    documentId: 'doc_demo',
    documentTitle: '第三章 导数与微分',
    providerId: 'demo',
    providerName: '本地演示模型',
    model: 'demo-tutor',
    createdAt: Date.now() - 1000 * 60 * 42,
    updatedAt: Date.now() - 1000 * 60 * 42,
    warnings: [],
    items: [
      {
        id: 'prb_1',
        type: 'choice',
        difficulty: 'medium',
        stem: '设 $f(x)=x^3-3x$，则 $f(x)$ 在 $x=1$ 处的导数值为：',
        options: ['$-3$', '$0$', '$3$', '$6$'],
        answer: 'B',
        explanation:
          '第一步：求导。$f\'(x)=3x^2-3$。\n\n第二步：代入 $x=1$，得 $f\'(1)=3-3=0$。\n\n> 注意：导数等于 0 只说明此处切线水平，$x=1$ 是极值点（这里是极小值点，$f(1)=-2$）。',
        sectionTitle: '导数计算',
        origin: 'ai'
      },
      {
        id: 'prb_2',
        type: 'calc',
        difficulty: 'hard',
        stem: '已知 $y=\\sin(2x+1)$，求 $\\dfrac{dy}{dx}$，并说明每一步用了什么法则。',
        options: [],
        answer: '$\\dfrac{dy}{dx}=2\\cos(2x+1)$',
        explanation:
          '第一步：识别结构。这是「外层 $\\sin u$ + 内层 $u=2x+1$」的复合函数。\n\n第二步：用链式法则 $\\dfrac{dy}{dx}=\\dfrac{dy}{du}\\cdot\\dfrac{du}{dx}$。\n\n第三步：外层求导 $\\dfrac{d}{du}\\sin u=\\cos u$，内层求导 $\\dfrac{du}{dx}=2$。\n\n第四步：乘起来得 $2\\cos(2x+1)$。',
        sectionTitle: '链式法则',
        origin: 'ai'
      }
    ]
  }
]

const documents = [
  {
    id: 'doc_demo',
    title: '第三章 导数与微分',
    sourceType: 'file',
    sourceUri: 'C:/课件/高等数学-第三章.pdf',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    blocks: [],
    plainText: '导数的定义……',
    meta: { fileName: '高等数学-第三章.pdf', ext: 'pdf', charCount: 12480, blockCount: 86, chunkCount: 4, pageCount: 18, warnings: ['PDF 以文本层提取，公式与图表可能有缺失'] }
  },
  {
    id: 'doc_web',
    title: '矩阵的秩：从线性相关到极大无关组',
    sourceType: 'web',
    sourceUri: 'https://example.com/linear-algebra/rank',
    createdAt: Date.now() - 1000 * 60 * 60 * 30,
    blocks: [],
    plainText: '矩阵的秩……',
    meta: { ext: 'html', charCount: 6320, blockCount: 42, chunkCount: 2, warnings: [] }
  },
  {
    id: 'doc_text',
    title: '老师给的复习题（第 5 章）',
    sourceType: 'text',
    createdAt: Date.now() - 1000 * 60 * 60 * 54,
    blocks: [],
    plainText: '复习题……',
    meta: { ext: 'txt', charCount: 1840, blockCount: 12, chunkCount: 1, warnings: [] }
  }
]

const settings = {
  activeProviderId: 'demo',
  useChunkSummary: true,
  providers: [
    { id: 'demo', name: '本地演示模型', kind: 'demo', baseUrl: '', model: 'demo-tutor', temperature: 0.6, hasKey: true },
    { id: 'prov_deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.6, hasKey: true }
  ]
}

const mock = `(() => {
  const documents = ${JSON.stringify(documents)}
  const artifact = ${JSON.stringify(artifact)}
  const problemSets = ${JSON.stringify(problemSets)}
  const settings = ${JSON.stringify(settings)}
  const info = { version: '1.0.0', platform: 'win32', dataDir: 'C:/Users/Lenovo/AppData/Roaming/AITutorAssistant/data', electron: '33.4.11', chrome: '130.0.6723.137', encryptionAvailable: true }
  const noop = () => {}
  window.tutor = {
    app: { info: async () => info, openDataDir: async () => {}, openExternal: async () => {} },
    docs: {
      list: async () => documents,
      get: async (id) => documents.find((d) => d.id === id) || null,
      importFiles: async () => ({ ok: false, canceled: true, documents: [], errors: [] }),
      importText: async () => ({ ok: false, error: 'preview mode' }),
      importWeb: async () => ({ ok: false, error: 'preview mode' }),
      importVisionPdf: async () => ({ ok: false, error: 'preview mode' }),
      onVisionEvent: () => noop,
      remove: async () => {}
    },
    web: {
      openCapture: async () => ({ ok: false, error: 'preview mode' }),
      captureState: async () => ({ open: false, url: '', title: '' }),
      captureCurrent: async () => ({ ok: false, error: 'preview mode' }),
      downloadAttachments: async () => ({ ok: false, documents: [], errors: [] }),
      closeCapture: async () => {}
    },
    practice: {
      list: async () => problemSets,
      get: async (id) => problemSets.find((s) => s.id === id) || null,
      generate: async () => ({ ok: false, error: 'preview mode' }),
      createManual: async () => ({ ok: false, error: 'preview mode' }),
      update: async (set) => ({ ok: true, set }),
      remove: async () => {}
    },
    lesson: {
      list: async () => [artifact],
      get: async () => artifact,
      generate: async () => ({ ok: false, error: 'preview mode' }),
      regenerateSection: async () => ({ ok: false, error: 'preview mode' }),
      cancel: async () => {},
      updateSection: async () => ({ ok: true }),
      updateKeyPoint: async () => ({ ok: true }),
      remove: async () => {},
      onEvent: () => noop
    },
    settings: {
      get: async () => settings,
      saveProvider: async () => settings,
      removeProvider: async () => settings,
      setActive: async () => settings,
      test: async () => ({ ok: true, message: '演示模式：跳过真实连接测试', latencyMs: 12 })
    },
    exporter: { run: async () => ({ ok: false, error: 'preview mode' }) }
  }
})()
`

await fs.writeFile(path.join(outDir, 'mock-tutor.js'), mock, 'utf8')

const indexHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf8')
const previewHtml = indexHtml.replace(
  '</head>',
  '  <script src="./mock-tutor.js"></script>\n  </head>'
)
await fs.writeFile(path.join(outDir, 'preview.html'), previewHtml, 'utf8')
console.log('preview written to', outDir)
