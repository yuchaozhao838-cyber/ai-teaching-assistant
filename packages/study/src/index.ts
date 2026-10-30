/**
 * @tutor/study —— 学习管理模块的纯逻辑（无 IO）：
 * 时间轴统计、连续天数、番茄钟结算、每日语录、错题辅助。
 * 桌面端与手机端共用，各自只负责存储。
 */
import type {
  CalendarEvent,
  CourseSlot,
  DailyQuote,
  FocusPreset,
  FocusSession,
  HomeworkRule,
  MistakeItem,
  StudyEvent,
  StudyKind,
  StudyStats
} from '@tutor/shared'

export const DEFAULT_PRESETS: FocusPreset[] = [
  {
    id: 'preset_25_5',
    name: '25 / 5 标准',
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    pomodorosPerLongBreak: 4,
    autoStartNext: false
  },
  {
    id: 'preset_50_10',
    name: '50 / 10 深度',
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 25,
    pomodorosPerLongBreak: 3,
    autoStartNext: false
  },
  {
    id: 'preset_90_20',
    name: '90 / 20 沉浸',
    focusMinutes: 90,
    shortBreakMinutes: 20,
    longBreakMinutes: 30,
    pomodorosPerLongBreak: 2,
    autoStartNext: false
  }
]

/** 本地时区的 YYYY-MM-DD */
export function isDateKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = new Date(`${value}T00:00:00`).getTime()
  if (Number.isNaN(time)) return false
  return true
}

export function toDateKey(input: Date | string = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function minutesBetween(startAt: string, endAt: string): number {
  const diff = new Date(endAt).getTime() - new Date(startAt).getTime()
  return Math.max(0, Math.round(diff / 60000))
}

/** 番茄钟结算：把一次 FocusSession 变成 StudyEvent（只有专注阶段才计入学习时长） */
export function focusSessionToEvent(session: FocusSession): StudyEvent | null {
  if (session.mode !== 'focus' || !session.completed) return null
  return {
    id: `evt_${session.id}`,
    date: toDateKey(session.startedAt),
    startAt: session.startedAt,
    endAt: session.endedAt,
    minutes: session.actualMinutes,
    kind: 'focus',
    refId: session.taskRef?.id,
    title: session.taskRef?.title ?? '专注'
  }
}

export function makeStudyEvent(input: {
  kind: StudyKind
  minutes: number
  startAt?: string
  endAt?: string
  refId?: string
  title?: string
}): StudyEvent {
  const startAt = input.startAt ?? new Date().toISOString()
  const endAt = input.endAt ?? new Date(new Date(startAt).getTime() + input.minutes * 60000).toISOString()
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    date: toDateKey(startAt),
    startAt,
    endAt,
    minutes: Math.max(1, Math.round(input.minutes)),
    kind: input.kind,
    refId: input.refId,
    title: input.title
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date): Date {
  const next = new Date(date)
  const weekday = (next.getDay() + 6) % 7 // 周一为一周开始
  next.setDate(next.getDate() - weekday)
  next.setHours(0, 0, 0, 0)
  return next
}

/** 统计：今日 / 本周 / 连续天数 / 最近 7 天 */
export function computeStats(events: StudyEvent[], now: Date = new Date()): StudyStats {
  const focusEvents = events.filter((event) => event.kind === 'focus')
  const today = toDateKey(now)
  const weekStart = startOfWeek(now).getTime()

  const perDay = new Map<string, { minutes: number; count: number }>()
  for (const event of focusEvents) {
    const entry = perDay.get(event.date) ?? { minutes: 0, count: 0 }
    entry.minutes += event.minutes
    entry.count += 1
    perDay.set(event.date, entry)
  }

  const todayEntry = perDay.get(today) ?? { minutes: 0, count: 0 }
  let weekMinutes = 0
  let weekCount = 0
  for (const [date, entry] of perDay) {
    if (new Date(`${date}T00:00:00`).getTime() >= weekStart) {
      weekMinutes += entry.minutes
      weekCount += entry.count
    }
  }

  // 连续专注天数：今天没专注则从昨天往前数（当天还没开始不算断）
  let streak = 0
  let cursor = new Date(now)
  if (!perDay.has(today)) cursor = addDays(cursor, -1)
  for (let index = 0; index < 3650; index += 1) {
    const key = toDateKey(cursor)
    if (perDay.has(key)) {
      streak += 1
      cursor = addDays(cursor, -1)
    } else {
      break
    }
  }

  const last7Days: StudyStats['last7Days'] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = toDateKey(addDays(now, -offset))
    const entry = perDay.get(date) ?? { minutes: 0, count: 0 }
    last7Days.push({ date, minutes: entry.minutes, count: entry.count })
  }

  const activeDays = last7Days.filter((item) => item.count > 0).length

  return {
    today: { focusCount: todayEntry.count, focusMinutes: todayEntry.minutes },
    week: { focusCount: weekCount, focusMinutes: weekMinutes, activeDays },
    streakDays: streak,
    last7Days
  }
}

/** 内置励志语料：按天轮换，同一天始终同一条 */
export const QUOTES: DailyQuote[] = [
  { text: '手机放另一个房间，专注力立刻高一档。', tag: '行动' },
  { text: '计划表是写给未来自己的情书，通常读不进去。写三条就够。', tag: '实话' },
  { text: '微积分是「用直的东西逼近弯的东西」：切线、线性化，都是同一件事。', tag: '视角' },
  { text: '我的学习计划一向很完美，除了执行部分。', tag: '自嘲' },
  { text: '今天只推进了一点点，也还是在往前。', tag: '陪伴' },
  { text: '记忆在睡眠中被巩固，睡前半小时看的东西第二天更容易想起来。', tag: '常识' },
  { text: '卡住超过 10 分钟，就把题目重新读一遍——通常漏了条件。', tag: '行动' },
  { text: '你不是没时间，你是一天里被切碎了十七次。', tag: '实话' },
  { text: '概率不是预测未来，是给不确定性标价。', tag: '视角' },
  { text: '打开书的那一刻，我离成功最近。', tag: '自嘲' },
  { text: '学不会的那部分，只是还没轮到它。', tag: '陪伴' },
  { text: '手写笔记比打字记得牢：写不快，就必须当场做取舍。', tag: '常识' },
  { text: '想不清楚就写下来，纸上的混乱好过脑子里的清晰。', tag: '行动' },
  { text: '效率工具解决不了拖延，删掉三个 App 更快。', tag: '实话' },
  { text: '线代里的变换，几乎都能拆成「拉伸 + 旋转 + 投影」。', tag: '视角' },
  { text: '「明天开始」是我最喜欢的四个字。', tag: '自嘲' },
  { text: '你已经比昨天多知道一点了。', tag: '陪伴' },
  { text: '工作记忆一次只能拿住约四个新信息块，所以「压缩」比「多记」重要。', tag: '常识' },
  { text: '把「今天学三小时」换成「今天做完这一节」，你会真的做完。', tag: '行动' },
  { text: '大部分「记不住」其实是「没理解」，不是「没重复」。', tag: '实话' },
  { text: '数据结构选错，代码会越写越像补丁。', tag: '视角' },
  { text: '图书馆最好的一点：在里面玩手机会愧疚。', tag: '自嘲' },
  { text: '慢一点没关系，方向对就行。', tag: '陪伴' },
  { text: '间隔重复的好节奏大约是：1 天、3 天、7 天、15 天。', tag: '常识' },
  { text: '复习不是重读，是不看书把要点讲一遍。', tag: '行动' },
  { text: '学得快的人不是聪明，是错得快、改得也快。', tag: '实话' },
  { text: '物理题里很多是守恒量在替你做题，你只负责挑对那个量。', tag: '视角' },
  { text: '复习到第三遍才发现，第一遍划的重点全错。', tag: '自嘲' },
  { text: '状态不好就少学一点，明天还有。', tag: '陪伴' },
  { text: '考试时先做会的题，能降低焦虑并提升后面的表现。', tag: '常识' },
  { text: '睡前列三件明天要做的事，比熬夜多学一小时划算。', tag: '行动' },
  { text: '熬夜多出来的两小时，第二天要还三小时。', tag: '实话' },
  { text: '化学平衡不是静止，是两个方向跑得一样快。', tag: '视角' },
  { text: '我的进度条永远停在 87%。', tag: '自嘲' },
  { text: '没有人一直在高效，休息也是进度的一部分。', tag: '陪伴' },
  { text: '咖啡因半衰期约五小时，下午三点后喝会压深睡。', tag: '常识' },
  { text: '先做最难看的那件，剩下的都会变轻。', tag: '行动' },
  { text: '状态差的时候学不进去很正常，那就整理笔记。', tag: '实话' },
  { text: '编程里最难的不是写，是删。', tag: '视角' },
  { text: '每次说要早睡，都是为了明天能早起学习（并没有）。', tag: '自嘲' },
  { text: '走神了拉回来，这也是一种练习。', tag: '陪伴' },
  { text: '20 分钟的小睡能提升警觉度，超过 30 分钟反而更困。', tag: '常识' },
  { text: '学不进去就先做五分钟，多数时候你会自己接着做下去。', tag: '行动' },
  { text: '谁都有看不进去的那一章，跳过它，先看下一章。', tag: '实话' },
  { text: '一个概念如果你能举出反例，才算真的懂。', tag: '视角' },
  { text: '打开 IDE 那一秒，我感觉自己已经写完了。', tag: '自嘲' },
  { text: '你不是在浪费时间，你是在消化。', tag: '陪伴' },
  { text: '手机在场（哪怕不看），认知表现就会下降。', tag: '常识' },
  { text: '抄一遍不如默一遍，默一遍不如讲一遍。', tag: '行动' },
  { text: '「我懂了」和「我能做出来」之间隔着一整晚。', tag: '实话' },
  { text: '数学证明的每一行都在回答「凭什么」。', tag: '视角' },
  { text: '划重点的笔比我的记性可靠。', tag: '自嘲' },
  { text: '这一章很难，但你已经在读了。', tag: '陪伴' },
  { text: '用「讲给别人听」的方式复述，能暴露八成你以为懂的地方。', tag: '常识' },
  { text: '笔记别抄板书，记「我为什么会错在这里」。', tag: '行动' },
  { text: '复习的黄金时机是「刚要忘」的时候，不是你想起来的时候。', tag: '实话' },
  { text: '能用人话解释清楚的东西，通常比公式更接近本质。', tag: '视角' },
  { text: '我看懂了答案，就以为自己会了——这是最大的错觉。', tag: '自嘲' },
  { text: '允许自己今天只做六成。', tag: '陪伴' },
  { text: '读不懂时会回读——回读多，说明该把那句话拆开。', tag: '常识' },
  { text: '一小时内被打断三次，等于没学。把通知关掉。', tag: '行动' },
  { text: '一天两小时坚持一百天，胜过一周二十小时。', tag: '实话' },
  { text: '所有公式都是压缩过的思路，展开它才能用。', tag: '视角' },
  { text: '上课走神三分钟，回来已经讲到第三章。', tag: '自嘲' },
  { text: '运动后的一小时，通常是当天最容易进入专注的时段。', tag: '常识' },
  { text: '不懂的先标记，攒够三个再去问——问得更准。', tag: '行动' },
  { text: '拖延多半因为任务太模糊，把它切成一个具体动作。', tag: '实话' },
  { text: '把抽象的东西画出来，它就不再抽象了。', tag: '视角' },
  { text: '把要背的东西读出声，比默读多一条听觉通路。', tag: '常识' },
  { text: '每天固定同一时间坐下，比每天决定「什么时候学」省力得多。', tag: '行动' },
  { text: '笔记整理得再漂亮，不进脑子也只是排版练习。', tag: '实话' },
  { text: '把手机静音十分钟，你会发现那十分钟特别长。', tag: '行动' },
  { text: '考试周之前那一周，抵得上平时一个月——但别指望它。', tag: '实话' },
]

export function quoteIndexFor(dateKey: string): number {
  let hash = 0
  for (let index = 0; index < dateKey.length; index += 1) hash = (hash * 31 + dateKey.charCodeAt(index)) % 100000
  return hash % QUOTES.length
}

export function quoteOfDay(now: Date = new Date()): DailyQuote {
  return QUOTES[quoteIndexFor(toDateKey(now))]
}

export function quoteAt(index: number): DailyQuote {
  if (!QUOTES.length) return { text: '' }
  const safe = ((index % QUOTES.length) + QUOTES.length) % QUOTES.length
  return QUOTES[safe]
}

/** 错题统计：按知识点聚合，用于错题本页面的分布展示 */
export function mistakeSummary(items: MistakeItem[]): {
  total: number
  learning: number
  mastered: number
  byKnowledge: Array<{ knowledge: string; count: number }>
} {
  const byKnowledge = new Map<string, number>()
  let learning = 0
  let mastered = 0
  for (const item of items) {
    if (item.status === 'mastered') mastered += 1
    else learning += 1
    const key = item.knowledgePoint?.trim() || '未标注知识点'
    byKnowledge.set(key, (byKnowledge.get(key) ?? 0) + 1)
  }
  return {
    total: items.length,
    learning,
    mastered,
    byKnowledge: [...byKnowledge.entries()]
      .map(([knowledge, count]) => ({ knowledge, count }))
      .sort((a, b) => b.count - a.count)
  }
}

/** 从题集题目构造错题（练习页「加入错题本」用） */
export function mistakeFromProblem(input: {
  problemSetId: string
  knowledgePoint?: string
  type: 'single' | 'multiple' | 'blank' | 'short'
  stem: string
  options?: string[]
  answer: string
  explanation: string
  wrongAnswer?: string
}): MistakeItem {
  return {
    id: `mis_${Math.random().toString(36).slice(2, 10)}`,
    source: 'quiz',
    knowledgePoint: input.knowledgePoint,
    type: input.type,
    stem: input.stem,
    options: input.options,
    answer: input.answer,
    explanation: input.explanation,
    wrongAnswer: input.wrongAnswer,
    status: 'learning',
    reviewCount: 0,
    createdAt: new Date().toISOString(),
    problemSetId: input.problemSetId
  }
}


/* ------------------------------ 日历 / 作业规则 ----------------------------- */

const WEEKDAY_LABEL = ['一', '二', '三', '四', '五', '六', '日']

/** 日期键加减天数 */
export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

/** ISO 星期转 1-7（周一=1） */
export function weekdayOf(dateKey: string): number {
  return ((new Date(`${dateKey}T00:00:00`).getDay() + 6) % 7) + 1
}

/** 生成一个月的日历网格（周一开头，固定 6 行） */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - startOffset)
  const days: string[] = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    days.push(toDateKey(date))
  }
  return days
}

/**
 * 把周期作业规则展开成日历事件（虚拟事件，source='rule'，不落库）。
 * 每条规则每周生成两条：布置（当天 assignTime）与截止（+submitDurationDays，全天）。
 */
export function expandHomeworkRules(rules: HomeworkRule[], fromKey: string, toKey: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    for (let cursor = fromKey; cursor <= toKey; cursor = shiftDateKey(cursor, 1)) {
      if (cursor < rule.startDate || cursor > rule.endDate) continue
      if (weekdayOf(cursor) !== rule.assignWeekday) continue
      const assignAt = `${cursor}T${rule.assignTime || '09:00'}:00`
      events.push({
        id: `rule_${rule.id}_${cursor}`,
        title: `${rule.courseName} 作业布置`,
        date: cursor,
        startTime: rule.assignTime || '09:00',
        allDay: false,
        type: 'study',
        note: `每周${WEEKDAY_LABEL[rule.assignWeekday - 1]}布置，${rule.submitDurationDays} 天后截止`,
        source: 'rule',
        createdAt: assignAt
      })
      const deadline = shiftDateKey(cursor, Math.max(1, rule.submitDurationDays))
      if (deadline <= toKey) {
        events.push({
          id: `rule_${rule.id}_dl_${deadline}`,
          title: `${rule.courseName} 作业截止`,
          date: deadline,
          allDay: true,
          type: 'deadline',
          note: `由「${rule.courseName}」周期规则自动生成`,
          source: 'rule',
          createdAt: assignAt
        })
      }
    }
  }
  return events
}

/* ---------------------------------- ICS ---------------------------------- */

function icsDate(dateKey: string, time?: string): string {
  const stamp = `${dateKey.replace(/-/g, '')}${time ? `${time.replace(':', '')}00` : 'T000000'}`
  return time ? stamp : stamp.replace(/T000000$/, '')
}

/** 导出 ICS（可被系统日历 / Google Calendar 订阅导入） */
export function toICS(events: CalendarEvent[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Tutor Assistant//Calendar//CN', 'CALSCALE:GREGORIAN']
  for (const event of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.id}@ai-tutor`)
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`)
      lines.push(`DTEND;VALUE=DATE:${icsDate(shiftDateKey(event.date, 1))}`)
    } else {
      lines.push(`DTSTART:${icsDate(event.date, event.startTime || '09:00')}`)
      lines.push(`DTEND:${icsDate(event.date, event.endTime || event.startTime || '10:00')}`)
    }
    lines.push(`SUMMARY:${(event.title || '日程').replace(/\n/g, ' ')}`)
    if (event.note) lines.push(`DESCRIPTION:${event.note.replace(/\n/g, '\\n')}`)
    lines.push(`CATEGORIES:${event.type}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/** 解析 ICS 文本（只取 VEVENT 的标题/时间/备注，够用即可） */
export function parseICS(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const blocks = text.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0]
    const read = (key: string): string => {
      const match = new RegExp(`^${key}[^:]*:(.*)$`, 'm').exec(body)
      return match ? match[1].trim() : ''
    }
    const uid = read('UID')
    const summary = read('SUMMARY').replace(/\\n/g, ' ')
    if (!summary) continue
    const dtstart = read('DTSTART')
    const dtend = read('DTEND')
    const dateOnly = dtstart.length === 8
    const date = dateOnly
      ? `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`
      : `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`
    const startTime = dateOnly ? undefined : `${dtstart.slice(9, 11)}:${dtstart.slice(11, 13)}`
    const endTime = !dateOnly && dtend.length >= 13 ? `${dtend.slice(9, 11)}:${dtend.slice(11, 13)}` : undefined
    events.push({
      id: `ics_${uid || Math.random().toString(36).slice(2, 8)}`,
      title: summary,
      date,
      startTime,
      endTime,
      allDay: dateOnly,
      type: 'custom',
      note: read('DESCRIPTION').replace(/\\n/g, '\n'),
      source: 'system',
      externalId: uid || undefined,
      createdAt: new Date().toISOString()
    })
  }
  return events
}


/* --------------------------------- 课表 --------------------------------- */

export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

/** 解析星期：支持 1-7、周一/星期一/礼拜一、mon..sun */
export function parseWeekday(raw: unknown): number | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric
  const map: Record<string, number> = {
    mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
    thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7
  }
  const key = value.replace(/[^a-z\u4e00-\u9fa5]/g, '')
  if (map[key]) return map[key]
  const match = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(value)
  if (match) return match[1] === '天' ? 7 : WEEKDAY_NAMES.indexOf(match[1]) + 1
  const single = key.replace(/^(周|星期|礼拜)/, '')
  if (single === '天') return 7
  const index = WEEKDAY_NAMES.indexOf(single)
  return index >= 0 ? index + 1 : null
}

/** 解析时间：支持 08:00 / 8:00 / 0800 / 第1-2节 */
export function parseTime(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const colon = /(\d{1,2})[:：](\d{2})/.exec(value)
  if (colon) return `${String(Math.min(23, Number(colon[1]))).padStart(2, '0')}:${colon[2].slice(0, 2)}`
  const compact = /^(\d{2})(\d{2})$/.exec(value)
  if (compact) return `${compact[1]}:${compact[2]}`
  const period = /第\s*(\d{1,2})\s*[-~—至]?\s*(\d{1,2})?\s*节/.exec(value)
  if (period) {
    const start = periodStart(Number(period[1]))
    const end = periodStart(Number(period[2] ?? period[1]) + 1)
    return start
  }
  return null
}

/** 常用作息（同济：1-2 节 08:00 起）；不在表里就按 8:00 + (n-1)*2 小时估 */
export function periodStart(period: number): string {
  const table: Record<number, string> = {
    1: '08:00', 2: '08:00', 3: '10:00', 4: '10:00', 5: '13:30', 6: '13:30',
    7: '15:30', 8: '15:30', 9: '18:00', 10: '18:00', 11: '20:00', 12: '20:00'
  }
  return table[period] ?? `${String(8 + Math.max(0, period - 1) * 2).padStart(2, '0')}:00`
}

export function periodEnd(period: number): string {
  const table: Record<number, string> = {
    1: '09:35', 2: '09:35', 3: '11:35', 4: '11:35', 5: '15:05', 6: '15:05',
    7: '17:05', 8: '17:05', 9: '19:35', 10: '19:35', 11: '21:35', 12: '21:35'
  }
  const [hour, minute] = (table[period] ?? '09:45').split(':').map(Number)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 从表格文本推断节次（"第3-4节" → 3） */
export function parsePeriodRange(raw: string): { start: number; end: number } | null {
  const match = /(\d{1,2})\s*[-~—至]\s*(\d{1,2})\s*节?/.exec(raw)
  if (match) {
    const start = Number(match[1])
    const end = Number(match[2])
    if (start >= 1 && end <= 20) return { start, end }
  }
  const single = /^(\d{1,2})\s*节?$/.exec(raw.trim())
  if (single) return { start: Number(single[1]), end: Number(single[1]) }
  return null
}

/** 稳定的课程配色 */
export function courseColor(name: string): string {
  const palette = ['#2f4bd8', '#1f9d76', '#b7791f', '#8b5cf6', '#d92d20', '#0284c7', '#c2410c', '#4d7c0f']
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 100000
  return palette[hash % palette.length]
}

/** CSV 导入课表：列名支持中英文（课程/星期/开始/结束/地点/老师/周次） */
export function csvToCourseSlots(csv: string): { slots: CourseSlot[]; errors: string[] } {
  const errors: string[] = []
  const lines = String(csv ?? '').replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length < 2) return { slots: [], errors: ['CSV 至少要有表头和一行数据'] }
  const splitRow = (line: string) => {
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (const char of line) {
      if (char === '"') quoted = !quoted
      else if (char === ',' && !quoted) {
        cells.push(current.trim())
        current = ''
      } else current += char
    }
    cells.push(current.trim())
    return cells
  }
  const header = splitRow(lines[0]).map((cell) => cell.toLowerCase())
  const find = (...names: string[]) => header.findIndex((cell) => names.some((name) => cell.includes(name)))
  const nameIndex = find('课程', 'course', '名称')
  const weekdayIndex = find('星期', '周', 'weekday', 'day')
  const startIndex = find('开始', 'start')
  const endIndex = find('结束', 'end')
  const locationIndex = find('地点', '教室', 'location', 'room')
  const teacherIndex = find('老师', '教师', 'teacher')
  const weeksIndex = find('周次', 'weeks')

  if (nameIndex < 0 || weekdayIndex < 0) {
    return { slots: [], errors: ['CSV 需要包含「课程」和「星期」两列'] }
  }

  const slots: CourseSlot[] = []
  lines.slice(1).forEach((line, index) => {
    const cells = splitRow(line)
    const name = cells[nameIndex]
    if (!name) return
    const weekday = parseWeekday(cells[weekdayIndex])
    if (!weekday) {
      errors.push(`第 ${index + 2} 行星期无法识别：${cells[weekdayIndex] ?? ''}`)
      return
    }
    const startTime = startIndex >= 0 ? parseTime(cells[startIndex]) : null
    const endTime = endIndex >= 0 ? parseTime(cells[endIndex]) : null
    slots.push({
      id: `slot_${Math.random().toString(36).slice(2, 10)}`,
      courseName: name,
      weekday: weekday as CourseSlot['weekday'],
      startTime: startTime ?? '08:00',
      endTime: endTime ?? '09:35',
      location: locationIndex >= 0 ? cells[locationIndex] || undefined : undefined,
      teacher: teacherIndex >= 0 ? cells[teacherIndex] || undefined : undefined,
      weeks: weeksIndex >= 0 ? cells[weeksIndex] || undefined : undefined,
      color: courseColor(name),
      source: 'import'
    })
  })
  return { slots, errors }
}

/** 从抓取到的 JSON 里尽力提取课表（字段名不固定，靠启发式） */
export function slotsFromJson(payload: unknown): CourseSlot[] {
  const collected: CourseSlot[] = []
  const seen = new Set<string>()

  const NAME_KEYS = ['coursename', 'coursetitle', 'kcmc', 'kcm', 'course', 'title']
  const WEEKDAY_KEYS = ['dayofweek', 'weekday', 'xqj', 'weekdayname', 'weekdayno', 'day']
  const START_KEYS = ['timestart', 'starttime', 'start_time', 'qsj', 'kssj', 'begintime', 'start']
  const END_KEYS = ['timeend', 'endtime', 'end_time', 'jssj', 'finish', 'end']
  const TEACHER_KEYS = ['teachername', 'teacher', 'skjs', 'instructor', 'rkjs', 'jsxm']
  // 教室：优先精确字段（roomIdI18n / classRoomName 才是名称）
  const PLACE_KEYS = [
    'roomlable',
    'classroomname',
    'classroomi18n',
    'roomidi18n',
    'roomname',
    'classroomstr',
    'location',
    'cdmc',
    'jxdd',
    'place'
  ]
  const PLACE_BAD = /roomid$|roomcategory|timeandroom|jsid/i
  const WEEK_KEYS = ['weeknum', 'weekstate', 'weekstr', 'weeks', 'arrangeweek']

  // 课程名不能取这些字段（老师/工号常叫 name/teacherName）
  const NAME_BAD = /teacher|instructor|skjs|jsxm|rkjs|staff|code|id$/i

  const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z]/g, '')

  const holidayRe = /国庆|中秋|元旦|清明|劳动节|端午|春节|元宵|假期|放假|调休|军训|运动会|考试周|监考|寒假|暑假/
  const teacherLike = (value: string) => /^[\u4e00-\u9fa5]{2,4}\s*[（(]?\s*\d{2,}/.test(value)

  const readRaw = (obj: Record<string, unknown>, keys: string[], bad?: RegExp): unknown => {
    const entries = Object.keys(obj).map((key) => ({ key, norm: normalizeKey(key) }))
    for (const wanted of keys) {
      const hit = entries.find((entry) => entry.norm === wanted || entry.norm.endsWith(wanted))
      if (!hit) continue
      if (bad && bad.test(hit.key)) continue
      const value = obj[hit.key]
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim()
        if (text) return text
      }
      if (Array.isArray(value) && value.length) return value
    }
    return null
  }

  /** 周次：支持 "[1-16]"、[1,2,3]、"1-16周"、"第1-16周"、65535（位图） 等 */
  const formatWeeks = (value: unknown): string | undefined => {
    if (value == null) return undefined
    if (Array.isArray(value)) {
      const numbers = value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
      if (!numbers.length) return undefined
      const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b)
      return `${sorted[0]}-${sorted[sorted.length - 1]}` === `${sorted[0]}-${sorted[sorted.length - 1]}`
        ? compactRanges(sorted)
        : undefined
    }
    const text = String(value).trim()
    if (!text) return undefined
    if (typeof value === 'number' || /^\d+$/.test(text)) {
      const numberValue = Number(text)
      // 65535 这类位图：按位还原
      if (numberValue > 63) {
        const weeks: number[] = []
        for (let bit = 0; bit < 32; bit += 1) {
          if ((numberValue >> bit) & 1) weeks.push(bit + 1)
        }
        if (weeks.length) return compactRanges(weeks)
      }
      return undefined
    }
    const match = /\[?([\d,\-\s]+)\]?/.exec(text)
    if (!match) return undefined
    const parts = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const weeks: number[] = []
    for (const part of parts) {
      const range = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(part)
      if (range) {
        const start = Number(range[1])
        const end = Number(range[2])
        for (let week = start; week <= end && week <= 30; week += 1) weeks.push(week)
        continue
      }
      const single = Number(part)
      if (Number.isFinite(single) && single > 0) weeks.push(single)
    }
    if (!weeks.length) return undefined
    return compactRanges(Array.from(new Set(weeks)).sort((a, b) => a - b))
  }

/** 从 "星期六 9-10节[1-16]线上课堂" / "[9-10节] [1-16] 社会实践(002137) 罗红杰(21109) 线上课堂" 里抠出教室 */
  const extractRoomFromText = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') return undefined
    const text = raw.trim()
    if (!text) return undefined
    const rest = text
      .replace(/[星期周][一二三四五六日天]/g, ' ')
      // [1-16] / [4-7, 16] 这类周次
      .replace(/\[\s*[\d,\-\s]+\s*\]/g, ' ')
      // 9-10节 / 第9-10节
      .replace(/第?\s*\d{1,2}\s*[-~—]\s*\d{1,2}\s*节/g, ' ')
      // 1-16周
      .replace(/\d{1,2}\s*[-~—]\s*\d{1,2}\s*周/g, ' ')
      // 课程名(课程号) / 老师(工号)
      .replace(/[^\s(（]+\s*[(（][A-Za-z0-9]+[)）]/g, ' ')
      .replace(/[()（）\[\]]/g, ' ')
    const parts = rest
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^\d+([-~]\d+)?$/.test(part))
      .filter((part) => !/^(节|周)$/.test(part))
    if (!parts.length) return undefined
    const room = parts[parts.length - 1]
    if (/^0+$/.test(room)) return undefined
    return room.length <= 24 ? room : room.slice(0, 24)
  }

  const walk = (node: unknown, depth: number, inheritedName?: string, inheritedRoom?: string) => {
    if (!node || depth > 8) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, inheritedName, inheritedRoom)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>

    const ownName = readRaw(obj, NAME_KEYS, NAME_BAD)
    const name = typeof ownName === 'string' ? ownName : inheritedName

    const ownRoomRaw = readRaw(obj, PLACE_KEYS, PLACE_BAD)
    const ownRoom =
      typeof ownRoomRaw === 'string' && !/^0+$/.test(ownRoomRaw) ? ownRoomRaw.slice(0, 24) : undefined
    const popoverRoom =
      extractRoomFromText(obj.popover) ??
      extractRoomFromText(obj.newPopover) ??
      extractRoomFromText(obj.timeAndRoom) ??
      extractRoomFromText(obj.timeTab)
    const room = ownRoom ?? popoverRoom ?? inheritedRoom
    const weekdayRaw = readRaw(obj, WEEKDAY_KEYS)

    if (name && typeof name === 'string' && weekdayRaw) {
      const weekday = parseWeekday(String(weekdayRaw))
      if (weekday && !holidayRe.test(name) && !teacherLike(name) && !/^\d+$/.test(name)) {
        const startRaw = readRaw(obj, START_KEYS)
        const endRaw = readRaw(obj, END_KEYS)
        // 节次优先（教务系统的 timeStart 往往是第几节，不是时间）
        const startPeriod = startRaw != null ? parsePeriodRange(String(startRaw)) : null
        const endPeriod = endRaw != null ? parsePeriodRange(String(endRaw)) : null
        const startTime = (startRaw ? parseTime(String(startRaw)) : null) ?? (startPeriod ? periodStart(startPeriod.start) : '08:00')
        const endTime =
          (endRaw ? parseTime(String(endRaw)) : null) ??
          (endPeriod ? periodEnd(endPeriod.end) : startPeriod ? periodEnd(startPeriod.end) : '09:35')
        const weeks = formatWeeks(readRaw(obj, WEEK_KEYS))
        const key = `${name}|${weekday}|${startTime}|${weeks ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          collected.push({
            id: `slot_${Math.random().toString(36).slice(2, 10)}`,
            courseName: String(name).slice(0, 40),
            weekday: weekday as CourseSlot['weekday'],
            startTime,
            endTime,
            location: room,
            teacher: (() => {
              const teacher = readRaw(obj, TEACHER_KEYS)
              return typeof teacher === 'string' ? teacher.replace(/[（(]\s*\d{3,}\s*[)）]$/, '').trim() : undefined
            })(),
            weeks,
            color: courseColor(String(name)),
            source: 'crawl'
          })
        }
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (!value || typeof value !== 'object') continue
      // timeTableList 等子数组继承父级课程名与教室
      walk(value, depth + 1, typeof name === 'string' ? name : inheritedName, room)
    }
  }

  walk(payload, 0)
  return collected
}

/** [1,2,3,5,6] → "1-3,5-6" */
function compactRanges(weeks: number[]): string {
  if (!weeks.length) return ''
  const parts: string[] = []
  let start = weeks[0]
  let prev = weeks[0]
  for (let index = 1; index <= weeks.length; index += 1) {
    const current = weeks[index]
    if (current !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = current
    }
    prev = current
  }
  return parts.filter(Boolean).join(',')
}

/* ---------------------------- 通用字段映射（多学校） ---------------------------- */

export interface JsonCandidateLike {
  id: string
  url: string
  json: unknown
}

/** 从任意 JSON 里找"像课表列表"的数组：元素是对象、数量 >= 2 */
export function discoverCandidates(sources: JsonCandidateLike[]): Array<{
  id: string
  url: string
  count: number
  keys: string[]
  sample: Record<string, string>
}> {
  const out: Array<{ id: string; url: string; count: number; keys: string[]; sample: Record<string, string> }> = []
  const walk = (node: unknown, depth: number, path: string): void => {
    if (!node || depth > 6) return
    if (Array.isArray(node)) {
      const objects = node.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
      if (objects.length >= 2) {
        const keys = new Set<string>()
        for (const obj of objects.slice(0, 5)) for (const key of Object.keys(obj)) keys.add(key)
        const sample: Record<string, string> = {}
        for (const key of keys) {
          const value = objects[0][key]
          if (typeof value === 'string' || typeof value === 'number') sample[key] = String(value).slice(0, 40)
        }
        if (Object.keys(sample).length) {
          out.push({ id: '', url: path, count: objects.length, keys: [...keys].slice(0, 30), sample })
        }
      }
      for (const item of node) walk(item, depth + 1, path)
      return
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) walk(value, depth + 1, `${path}.${key}`)
    }
  }
  for (const source of sources) {
    const before = out.length
    walk(source.json, 0, source.url)
    for (let index = before; index < out.length; index += 1) out[index].id = `${source.id}#${index - before}`
  }
  return out.slice(0, 20)
}

/** 按用户指定的字段把 JSON 转成课程（多学校通用） */
export function slotsWithMapping(
  json: unknown,
  mapping: { nameKey: string; weekdayKey: string; startKey?: string; endKey?: string; locationKey?: string; teacherKey?: string }
): CourseSlot[] {
  const slots: CourseSlot[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (!node || depth > 6) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    const read = (key?: string): string | null => {
      if (!key) return null
      const value = obj[key]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : null
    }
    const name = read(mapping.nameKey)
    const weekdayRaw = read(mapping.weekdayKey)
    if (name && weekdayRaw) {
      const weekday = parseWeekday(weekdayRaw)
      if (weekday) {
        const startRaw = read(mapping.startKey)
        const endRaw = read(mapping.endKey)
        const key = `${name}|${weekday}|${startRaw ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          slots.push({
            id: `slot_${Math.random().toString(36).slice(2, 10)}`,
            courseName: name.slice(0, 40),
            weekday: weekday as CourseSlot['weekday'],
            startTime: (startRaw ? parseTime(startRaw) : null) ?? '08:00',
            endTime: (endRaw ? parseTime(endRaw) : null) ?? '09:35',
            location: read(mapping.locationKey) ?? undefined,
            teacher: read(mapping.teacherKey) ?? undefined,
            color: courseColor(name),
            source: 'crawl'
          })
        }
      }
    }
    for (const value of Object.values(obj)) if (value && typeof value === 'object') walk(value, depth + 1)
  }
  walk(json, 0)
  return slots
}


/* ------------------------------- 教学周 ------------------------------- */

/** "4-7,16" / "[1-16]" / "1-16周" → [1..16]；无法识别返回 null（表示每周都上） */
export function parseWeekNumbers(weeks?: string): number[] | null {
  if (!weeks) return null
  const text = String(weeks).replace(/[\[\]周\s]/g, '')
  if (!text) return null
  const numbers: number[] = []
  for (const part of text.split(',')) {
    if (!part) continue
    const range = /^(\d{1,2})-(\d{1,2})$/.exec(part)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      for (let week = start; week <= end && week <= 30; week += 1) numbers.push(week)
      continue
    }
    const single = Number(part)
    if (Number.isFinite(single) && single > 0 && single <= 30) numbers.push(single)
  }
  if (!numbers.length) return null
  return Array.from(new Set(numbers)).sort((a, b) => a - b)
}

/** 这门课在第 week 周上不上 */
export function isWeekActive(weeks: string | undefined, week: number): boolean {
  const list = parseWeekNumbers(weeks)
  if (!list) return true
  return list.includes(week)
}

/** 第 week 周（周一开始）的 7 个日期；termStart 是第 1 周周一 */
export function weekDates(termStart: string, week: number): string[] {
  if (!isDateKey(termStart)) return []
  const start = new Date(`${termStart}T00:00:00`)
  start.setDate(start.getDate() + (week - 1) * 7)
  const days: string[] = []
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    days.push(toDateKey(date))
  }
  return days
}

/** 若已知开学日，算"今天是第几周" */
export function weekOfDate(termStart: string, date: Date = new Date()): number {
  const start = new Date(`${termStart}T00:00:00`)
  const diff = Math.floor((date.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000))
  return Math.max(1, diff + 1)
}


/* --------------------------- 教学周：按日历推进 --------------------------- */

/** 某天所在周的周一 */
export function mondayOf(dateKey: string): string {
  if (!isDateKey(dateKey)) return ''
  const date = new Date(`${dateKey}T00:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return toDateKey(date)
}

/** 第 1 周周一的日期 + 今天 → 当前第几周（自动推进，超出总周数时钳住） */
export function weekOfTerm(termStart: string, today: Date = new Date(), totalWeeks = 30): number {
  const monday = mondayOf(termStart)
  if (!monday) return 1
  const start = new Date(`${monday}T00:00:00`).getTime()
  const now = new Date(`${toDateKey(today)}T00:00:00`).getTime()
  const diffDays = Math.floor((now - start) / (24 * 3600 * 1000))
  const week = Math.floor(diffDays / 7) + 1
  return Math.min(Math.max(1, week), Math.max(1, totalWeeks))
}

/** 某日期是否落在放假区间里 */
export function isVacationDay(dateKey: string, ranges: Array<{ start: string; end: string }> | undefined): boolean {
  if (!ranges?.length) return false
  return ranges.some((range) => dateKey >= range.start && dateKey <= range.end)
}

/** 期初/期末倒计时：目标日期 - 今天（正数未到，负数已过） */
export function daysUntil(target: string, today: Date = new Date()): number {
  if (!isDateKey(target)) return 0
  const targetTime = new Date(`${target}T00:00:00`).getTime()
  const nowTime = new Date(`${toDateKey(today)}T00:00:00`).getTime()
  return Math.round((targetTime - nowTime) / (24 * 3600 * 1000))
}

/** 第 week 周的周一日期（用于算考试周开始日） */
export function weekStartDate(termStart: string, week: number): string {
  const monday = mondayOf(termStart)
  if (!monday) return ''
  return shiftDateKey(monday, (week - 1) * 7)
}
