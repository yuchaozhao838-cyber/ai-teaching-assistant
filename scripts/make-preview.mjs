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


const calendarEvents = [
  { id: 'cal_1', title: '高数第三章复习', date: '2026-10-30', startTime: '19:00', endTime: '20:30', allDay: false, type: 'study', source: 'app', createdAt: '2026-10-28T10:00:00+08:00' },
  { id: 'cal_2', title: '期中考试（高数）', date: '2026-11-05', allDay: true, type: 'exam', source: 'app', createdAt: '2026-10-28T10:00:00+08:00', note: '教学楼 A301' }
]
const homeworkRules = [
  { id: 'rule_1', courseName: '高等数学', assignWeekday: 1, assignTime: '09:00', submitDurationDays: 3, startDate: '2026-09-01', endDate: '2027-01-10', active: true }
]

const courseSlots = [
  { id: 'slot_1', courseName: '高等数学（A）', weekday: 1, startTime: '08:00', endTime: '09:35', location: 'A301', teacher: '王老师', weeks: '1-16', location: '北209', color: '#2f4bd8', source: 'crawl' },
  { id: 'slot_2', courseName: '大学物理', weekday: 1, startTime: '10:00', endTime: '11:35', location: 'B102', teacher: '李老师', weeks: '4-7,16', location: '线上课堂', color: '#1f9d76', source: 'crawl' },
  { id: 'slot_3', courseName: '线性代数', weekday: 3, startTime: '08:00', endTime: '09:35', location: 'A205', weeks: '1-16', color: '#b7791f', source: 'crawl' },
  { id: 'slot_4', courseName: '程序设计（C++）', weekday: 4, startTime: '13:30', endTime: '15:05', location: '机房 3', weeks: '9-12', color: '#8b5cf6', source: 'crawl' },
  { id: 'slot_5', courseName: '大学英语', weekday: 5, startTime: '10:00', endTime: '11:35', location: '外语楼 201', weeks: '1-16', color: '#0284c7', source: 'crawl' }
]

const prepGoals = [
  {
    id: 'prep_1',
    title: '两个月备考四级',
    examName: '英语四级',
    examDate: '2026-12-19',
    startDate: '2026-10-20',
    weeks: 8,
    dailyMinutes: 90,
    baseline: '上次 425 分',
    targetScore: '目标 500 分',
    materialIds: ['doc_1'],
    summary: '用 8 周、每天 90 分钟准备英语四级：前 3 周摸底与词汇基础，中间 3 周专项突破听力与阅读，最后 2 周模考冲刺。',
    advice: [
      '先做一套真题摸底，确定听力、阅读、写作各自的失分比例。',
      '每天 90 分钟拆成 40 + 50 两段，比一次硬撑更容易坚持。',
      '错题本按题型归类，同一类错三次以上就专门攻它。'
    ],
    phases: [
      {
        id: 'phase_0', name: '第一阶段：摸底与词汇（第 1-3 周）', weekFrom: 1, weekTo: 3, focus: '摸清短板，建立每日习惯',
        tasks: [
          { id: 't1', title: '做一套四级真题摸底，记录各题型错题数', kind: 'mock', week: 1, minutes: 90, done: true },
          { id: 't2', title: '每天背 30 个高频词，用间隔重复复习前一天', kind: 'vocab', week: 1, minutes: 30, done: true },
          { id: 't3', title: '整理错题本，按听力/阅读/写作分类', kind: 'review', week: 2, minutes: 40, done: false }
        ]
      },
      {
        id: 'phase_1', name: '第二阶段：专项突破（第 4-6 周）', weekFrom: 4, weekTo: 6, focus: '听力与阅读专项训练',
        tasks: [
          { id: 't4', title: '每天 1 篇仔细阅读限时训练，做完当天订正', kind: 'practice', week: 4, minutes: 40, done: false },
          { id: 't5', title: '每天精听一段真题音频，跟读三遍', kind: 'listen', week: 5, minutes: 30, done: false },
          { id: 't6', title: '积累写作模板并仿写两篇', kind: 'write', week: 6, minutes: 35, done: false }
        ]
      },
      {
        id: 'phase_2', name: '第三阶段：模考冲刺（第 7-8 周）', weekFrom: 7, weekTo: 8, focus: '按考试节奏模考，查漏补缺',
        tasks: [
          { id: 't7', title: '每周一套限时模考，严格掐表', kind: 'mock', week: 7, minutes: 90, done: false },
          { id: 't8', title: '考前三天只过错题本和高频词', kind: 'review', week: 8, minutes: 30, done: false }
        ]
      }
    ],
    createdAt: '2026-10-20T09:00:00+08:00',
    updatedAt: '2026-10-29T21:10:00+08:00'
  }
]

const ideaNotes = [
  { id: 'idea_1', title: '用切线斜率理解导数的直观含义', content: '今天讲到导数的时候老师提了一句：先把割线画出来，让两个点慢慢靠近，割线就变成切线。用这个方式讲比先抛极限定义好懂很多。\n\n可以做成一个动画：一个动点在曲线上滑动，另一个点固定，割线实时变化。', tags: ['高数', '教学想法'], createdAt: '2026-10-29T10:20:00+08:00', updatedAt: '2026-10-30T09:10:00+08:00', source: 'manual' },
  { id: 'idea_2', title: '错题本按知识点聚类', content: '错题攒多了以后，按知识点分组比按时间排序更有用 —— 能直接看出哪块最薄弱。', tags: ['产品'], createdAt: '2026-10-28T20:05:00+08:00', updatedAt: '2026-10-28T20:05:00+08:00', source: 'quick' }
]

const timetableMeta = { week: 7, termName: '2026-2027学年度第1学期', termStart: '2026-09-14', totalWeeks: 18, examWeekStart: 17, examWeekEnd: 18, vacations: [{ start: '2026-10-01', end: '2026-10-07', name: '国庆' }], updatedAt: new Date().toISOString() }
const studyStats = {
  today: { focusCount: 3, focusMinutes: 75 },
  week: { focusCount: 11, focusMinutes: 265, activeDays: 5 },
  streakDays: 4,
  last7Days: [
    { date: '2026-10-24', minutes: 50, count: 2 },
    { date: '2026-10-25', minutes: 25, count: 1 },
    { date: '2026-10-26', minutes: 0, count: 0 },
    { date: '2026-10-27', minutes: 75, count: 3 },
    { date: '2026-10-28', minutes: 50, count: 2 },
    { date: '2026-10-29', minutes: 75, count: 3 },
    { date: '2026-10-30', minutes: 75, count: 3 }
  ]
}
const studyQuote = { text: '把不会的弄会，就是提分最直接的路径。' }
const focusPresets = [
  { id: 'preset_25_5', name: '25 / 5 标准', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, pomodorosPerLongBreak: 4, autoStartNext: false },
  { id: 'preset_50_10', name: '50 / 10 深度', focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 25, pomodorosPerLongBreak: 3, autoStartNext: false }
]
const focusSessions = [
  { id: 'focus_1', mode: 'focus', presetId: 'preset_25_5', plannedMinutes: 25, startedAt: '2026-10-30T09:10:00+08:00', endedAt: '2026-10-30T09:35:00+08:00', pausedMinutes: 0, actualMinutes: 25, completed: true, taskRef: { type: 'document', id: 'doc_demo', title: '第三章 导数与微分' } },
  { id: 'focus_2', mode: 'focus', presetId: 'preset_25_5', plannedMinutes: 25, startedAt: '2026-10-30T10:05:00+08:00', endedAt: '2026-10-30T10:30:00+08:00', pausedMinutes: 2, actualMinutes: 25, completed: true, taskRef: { type: 'problemSet', id: 'pset_demo', title: '第三章 导数与微分 · 习题' } }
]
const mistakes = [
  {
    id: 'mis_demo_1',
    source: 'quiz',
    knowledgePoint: '链式法则',
    type: 'single',
    stem: '设 $y=\\sin(2x+1)$，则 $\\dfrac{dy}{dx}=$？',
    options: ['$2\\cos(2x+1)$', '$\\cos(2x+1)$', '$2\\sin(2x+1)$', '$-2\\cos(2x+1)$'],
    answer: 'A',
    explanation: '外层 $\\sin u$、内层 $u=2x+1$，链式法则要乘以内层导数 2，因此是 $2\\cos(2x+1)$。',
    wrongAnswer: 'B',
    status: 'learning',
    reviewCount: 0,
    createdAt: '2026-10-30T09:20:00+08:00'
  },
  {
    id: 'mis_demo_2',
    source: 'manual',
    knowledgePoint: '极值判定',
    type: 'short',
    stem: '为什么 $f(x_0)=0$ 不能直接说明 $x_0$ 是极值点？',
    answer: '驻点也可能是拐点，例如 $f(x)=x^3$ 在 $x=0$ 处。',
    explanation: '导数等于 0 只是必要条件；还需看两侧单调性是否改变（或二阶导不为 0）。',
    status: 'mastered',
    reviewCount: 2,
    lastReviewedAt: '2026-10-30T10:40:00+08:00',
    createdAt: '2026-10-29T20:10:00+08:00'
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
  const studyStats = ${JSON.stringify(studyStats)}
  const studyQuote = ${JSON.stringify(studyQuote)}
  const focusPresets = ${JSON.stringify(focusPresets)}
  const focusSessions = ${JSON.stringify(focusSessions)}
  const mistakes = ${JSON.stringify(mistakes)}
  const calendarEvents = ${JSON.stringify(calendarEvents)}
  const homeworkRules = ${JSON.stringify(homeworkRules)}
  const courseSlots = ${JSON.stringify(courseSlots)}
  const timetableMeta = ${JSON.stringify(timetableMeta)}
  const ideaNotes = ${JSON.stringify(ideaNotes)}
  const prepGoals = ${JSON.stringify(prepGoals)}
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
    study: {
      events: async () => [],
      stats: async () => studyStats,
      addEvent: async (input) => ({ id: 'evt_demo', date: '2026-10-30', startAt: new Date().toISOString(), endAt: new Date().toISOString(), minutes: input.minutes, kind: input.kind, title: input.title }),
      removeEvent: async () => {},
      quote: async () => studyQuote
    },
    focus: {
      presets: async () => focusPresets,
      savePreset: async (preset) => [...focusPresets, preset],
      removePreset: async () => focusPresets,
      sessions: async () => focusSessions,
      finish: async (session) => ({ session: { ...session, id: 'focus_demo' }, event: null })
    },
    prep: {
      list: async () => prepGoals,
      save: async (goal) => goal,
      remove: async () => {},
      generate: async (input) => ({
        ok: true,
        goal: {
          ...prepGoals[0],
          id: 'prep_new',
          title: input.title,
          examName: input.examName,
          weeks: input.weeks,
          dailyMinutes: input.dailyMinutes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }),
      advise: async () => ({ ok: true, advice: ['【预览环境】AI 建议示例：你已导入的《第三章 导数与微分》偏数学，四级备考建议补一套近三年真题。'] })
    },
    ideas: {
      list: async () => ideaNotes,
      save: async (idea) => ({ ...idea, id: idea.id || 'idea_new', updatedAt: new Date().toISOString() }),
      remove: async () => {},
      polish: async (input) => ({ ok: true, text: '【预览环境】AI 润色示例：' + input.text })
    },
    timetable: {
      list: async () => courseSlots,
      save: async (list) => list,
      importCsv: async () => ({ ok: false, slots: [], errors: ['preview'] }),
      meta: async () => timetableMeta,
      saveMeta: async (meta) => meta,
      openCrawler: async () => ({ ok: false, error: 'preview' }),
      capture: async () => ({ ok: false, slots: [], note: 'preview' }),
      closeCrawler: async () => {}
    },
    calendar: {
      events: async () => calendarEvents,
      saveEvent: async (event) => ({ ...event, id: event.id || 'cal_demo', createdAt: new Date().toISOString() }),
      removeEvent: async () => {},
      rules: async () => homeworkRules,
      saveRule: async (rule) => [...homeworkRules, rule],
      removeRule: async () => homeworkRules,
      importIcs: async () => ({ ok: true, imported: 0, skipped: 0 }),
      exportIcs: async () => ({ ok: true, text: 'BEGIN:VCALENDAR END:VCALENDAR' })
    },
    mistakes: {
      list: async () => mistakes,
      add: async (items) => items.map((item, index) => ({ ...item, id: 'mis_demo_' + index, source: 'manual', type: 'short', stem: item.stem || '', answer: item.answer || '', explanation: item.explanation || '', status: 'learning', reviewCount: 0, createdAt: new Date().toISOString() })),
      update: async (id, patch) => ({ ...mistakes[0], ...patch, id }),
      remove: async () => {},
      clearMastered: async () => {}
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
