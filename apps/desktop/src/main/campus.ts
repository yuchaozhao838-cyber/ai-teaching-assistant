/**
 * 教务系统课表抓取（多学校通用）：
 * - 打开真实登录窗口（独立持久化分区，登录态保留）
 * - 持续监听该窗口的 JSON 响应（课表接口通常是 JSON）
 * - 抓取时同时做一次 DOM 表格解析；有接口结果就优先用接口，DOM 只做兜底
 * - 抓不到时把接口候选交给用户做「字段映射」
 */
import { BrowserWindow } from 'electron'
import type { CourseSlot, JsonCandidate, TimetableMapping } from '@tutor/shared'
import {
  courseColor,
  discoverCandidates,
  parsePeriodRange,
  parseTime,
  parseWeekday,
  periodEnd,
  periodStart,
  slotsFromJson,
  slotsWithMapping
} from '@tutor/study'

const PARTITION = 'persist:aitutor-campus'
const MAX_BODIES = 60
const MAX_BODY_BYTES = 3 * 1024 * 1024

interface CapturedBody {
  id: string
  url: string
  body: string
  at: number
}

let campusWindow: BrowserWindow | null = null
let debuggerAttached = false
const captured: CapturedBody[] = []
const pendingRequests = new Map<string, string>()

export function getCampusWindow(): BrowserWindow | null {
  return campusWindow && !campusWindow.isDestroyed() ? campusWindow : null
}

function attachCapture(win: BrowserWindow) {
  try {
    const dbg = win.webContents.debugger
    if (!debuggerAttached) {
      dbg.attach('1.3')
      debuggerAttached = true
    }
    void dbg.sendCommand('Network.enable').catch(() => undefined)
    dbg.on('message', (_event, method, params) => {
      if (method === 'Network.responseReceived') {
        const { requestId, response } = params as { requestId: string; response: { url: string; mimeType?: string } }
        const mime = (response.mimeType ?? '').toLowerCase()
        if (mime.includes('json') || /api|course|schedule|curriculum|kebiao|lesson|timetable/i.test(response.url)) {
          pendingRequests.set(requestId, response.url)
        }
      }
      if (method === 'Network.loadingFinished') {
        const { requestId } = params as { requestId: string }
        const url = pendingRequests.get(requestId)
        if (!url) return
        pendingRequests.delete(requestId)
        void dbg
          .sendCommand('Network.getResponseBody', { requestId })
          .then((result) => {
            const body = (result as { body?: string }).body ?? ''
            if (!body || body.length > MAX_BODY_BYTES) return
            captured.push({ id: `cap_${captured.length}_${Date.now().toString(36)}`, url, body, at: Date.now() })
            if (captured.length > MAX_BODIES) captured.shift()
          })
          .catch(() => undefined)
      }
    })
    win.webContents.once('destroyed', () => {
      debuggerAttached = false
    })
  } catch {
    // 调试器 attach 失败不影响登录与 DOM 抓取
  }
}

export async function openCampusWindow(url: string): Promise<{ ok: boolean; error?: string }> {
  const target = url.trim()
  if (!target) return { ok: false, error: '请先填写你学校的教务系统地址' }
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: '地址要以 http:// 或 https:// 开头' }

  const existing = getCampusWindow()
  if (existing) {
    existing.show()
    existing.focus()
    try {
      await existing.loadURL(target)
    } catch {
      return { ok: false, error: '页面加载超时，请检查网络' }
    }
    return { ok: true }
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: '教务系统 — 登录后打开「我的课表」，再回到主窗口点「抓取课表」',
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true
    }
  })
  campusWindow = win
  win.on('closed', () => {
    campusWindow = null
    debuggerAttached = false
    pendingRequests.clear()
  })
  attachCapture(win)

  try {
    await win.loadURL(target)
  } catch {
    return { ok: false, error: '页面加载超时，请检查网络' }
  }
  return { ok: true }
}

export function closeCampusWindow(): void {
  const win = getCampusWindow()
  if (win) win.close()
  campusWindow = null
}

export function capturedCount(): number {
  return captured.length
}

/* ------------------------------- DOM 解析脚本 ------------------------------- */

const DOM_EXTRACT = `(() => {
  const WD = /(?:周|星期|礼拜)([一二三四五六日天])/;
  const cells = [];
  const readCell = (cell) => {
    const text = ((cell && cell.innerText) || '').trim();
    const title = (cell && (cell.getAttribute('title') || cell.getAttribute('data-title') || cell.getAttribute('aria-label'))) || '';
    return { text, title };
  };
  const tables = Array.from(document.querySelectorAll('table'));
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 3) continue;
    const header = Array.from(rows[0].children).map((c) => (c.innerText || '').trim());
    const weekdayCols = [];
    header.forEach((text, index) => {
      const m = WD.exec(text);
      if (m) weekdayCols.push({ index, weekday: m[1] === '天' ? 7 : '一二三四五六日'.indexOf(m[1]) + 1 });
    });
    if (!weekdayCols.length) continue;
    for (const row of rows.slice(1)) {
      const rowCells = Array.from(row.children);
      const periodText = ((rowCells[0] && rowCells[0].innerText) || '').trim();
      for (const col of weekdayCols) {
        const cell = rowCells[col.index];
        const { text, title } = readCell(cell);
        if (!text && !title) continue;
        cells.push({ weekday: col.weekday, raw: text, title, periodText });
      }
    }
  }
  return { cells, title: document.title, url: location.href };
})()`

/* -------------------------------- 单元格解析 -------------------------------- */

const HOLIDAY_PATTERN = /国庆|中秋|元旦|清明|劳动节|端午|春节|元宵|假期|放假|调休|军训|运动会|考试周|监考|寒假|暑假/
const HEADER_PATTERN = /^(第?\s*\d{1,2}\s*[-~—至]?\s*\d{0,2}\s*节|节次|时间|星期|周[一二三四五六日天]|上午|下午|晚上|\d{1,2}:\d{2})$/
const TEACHER_LINE = /^[\u4e00-\u9fa5]{2,4}\s*[（(]?\s*\d{3,}\s*[)）]?$|老师|教师|教授|讲师/
const PLACE_LINE = /楼|室|馆|校区|教\d|A\d{2,}|B\d{2,}|C\d{2,}|\d{3,4}\s*$/
const WEEK_LINE = /周次|[单双]周|\d+\s*-\s*\d+\s*周/

function looksLikeTeacherName(value: string): boolean {
  return /^[\u4e00-\u9fa5]{2,4}\s*[（(]?\s*\d{2,}/.test(value)
}

/** 一组文本行 → 一门课的字段 */
function parseCourseGroup(lines: string[]): { name: string; teacher?: string; location?: string; weeks?: string } | null {
  const teachers: string[] = []
  const places: string[] = []
  const weeks: string[] = []
  const rest: string[] = []

  for (const line of lines) {
    if (!line) continue
    if (TEACHER_LINE.test(line) && line.length <= 16) {
      teachers.push(line.replace(/[（(]?\s*\d{3,}\s*[)）]?$/, '').trim())
      continue
    }
    if (PLACE_LINE.test(line) && line.length <= 20) {
      places.push(line)
      continue
    }
    if (WEEK_LINE.test(line) && line.length <= 20) {
      weeks.push(line)
      continue
    }
    rest.push(line)
  }

  const candidates = rest
    .filter((line) => line.length >= 2 && !HEADER_PATTERN.test(line) && !HOLIDAY_PATTERN.test(line))
    .sort((a, b) => b.length - a.length)
  const name = candidates[0]?.replace(/\s+/g, ' ').trim()
  if (!name || name.length < 2) return null
  if (HOLIDAY_PATTERN.test(name)) return null

  return { name: name.slice(0, 40), teacher: teachers[0], location: places[0], weeks: weeks[0] }
}

/** 一个格子 → 可能的多门课（按空行切段；title 里的课程名优先） */
export function parseCellCourses(
  raw: string,
  titleAttr?: string
): Array<{ name: string; teacher?: string; location?: string; weeks?: string }> {
  const text = String(raw ?? '').replace(/\r/g, '')
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
    .filter((lines) => lines.length)

  const parsed: Array<{ name: string; teacher?: string; location?: string; weeks?: string }> = []
  for (const lines of blocks) {
    const course = parseCourseGroup(lines)
    if (course) parsed.push(course)
  }

  const titleName = (titleAttr ?? '').split(/[\n|]/)[0]?.trim() ?? ''

  // 有些系统单元格里只有老师名，课程名放在 title 属性里 —— 用 title 兜底
  if (!parsed.length) {
    if (titleName && !looksLikeTeacherName(titleName) && !HOLIDAY_PATTERN.test(titleName)) {
      const teacherMatch = /([\u4e00-\u9fa5]{2,4})\s*[（(]?\s*\d{3,}/.exec(text)
      const placeMatch = /([A-Za-z]?\d{2,4}(?:室|楼)?|[\u4e00-\u9fa5]{2,6}楼\s*\d{0,4})/.exec(text)
      return [
        {
          name: titleName.slice(0, 40),
          teacher: teacherMatch?.[1],
          location: placeMatch?.[1]
        }
      ]
    }
    return []
  }

  return parsed.map((course) =>
    looksLikeTeacherName(course.name) && titleName && !looksLikeTeacherName(titleName)
      ? { ...course, name: titleName.slice(0, 40) }
      : course
  )
}

/** 表格单元格 → 课程（时间以「节次」为准，单元格里明确写时间才用） */
export function slotsFromCells(
  cells: Array<{ weekday: number; raw: string; title?: string; periodText: string }>
): CourseSlot[] {
  const slots: CourseSlot[] = []
  for (const cell of cells) {
    const weekday = cell.weekday || parseWeekday(cell.raw)
    if (!weekday) continue
    const period = parsePeriodRange(cell.periodText)
    const explicit = /(\d{1,2}[:：]\d{2})\s*[-~—到至]\s*(\d{1,2}[:：]\d{2})/.exec(String(cell.raw))
    const startTime = explicit ? parseTime(explicit[1].replace('：', ':')) : period ? periodStart(period.start) : null
    const endTime = explicit ? parseTime(explicit[2].replace('：', ':')) : period ? periodEnd(period.end) : null
    if (!startTime || !endTime) continue

    for (const course of parseCellCourses(cell.raw, cell.title)) {
      slots.push({
        id: `slot_${Math.random().toString(36).slice(2, 10)}`,
        courseName: course.name,
        weekday: weekday as CourseSlot['weekday'],
        startTime,
        endTime,
        location: course.location,
        teacher: course.teacher,
        weeks: course.weeks,
        color: courseColor(course.name),
        source: 'crawl'
      })
    }
  }
  return slots
}

/**
 * 同一时段的多门课合并成一条（课程名用 / 连接），避免同一位置叠一堆卡片。
 */
export function mergeSlots(slots: CourseSlot[]): CourseSlot[] {
  const map = new Map<
    string,
    { weekday: number; startTime: string; endTime: string; weeks?: string; color: string; names: Set<string>; places: Set<string>; teachers: Set<string> }
  >()

  for (const slot of slots) {
    const key = `${slot.weekday}|${slot.startTime}|${slot.endTime}|${slot.courseName}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        weeks: slot.weeks,
        color: slot.color ?? courseColor(slot.courseName),
        names: new Set([slot.courseName]),
        places: new Set(slot.location ? [slot.location] : []),
        teachers: new Set(slot.teacher ? [slot.teacher] : [])
      })
      continue
    }
    existing.names.add(slot.courseName)
    if (slot.location) existing.places.add(slot.location)
    if (slot.teacher) existing.teachers.add(slot.teacher)
    if (!existing.weeks && slot.weeks) existing.weeks = slot.weeks
  }

  return [...map.values()]
    .map((entry) => ({
      id: `slot_${Math.random().toString(36).slice(2, 10)}`,
      courseName: [...entry.names].join(' / ').slice(0, 80),
      weekday: entry.weekday as CourseSlot['weekday'],
      startTime: entry.startTime,
      endTime: entry.endTime,
      location: [...entry.places].join(' / ') || undefined,
      teacher: [...entry.teachers].join(' / ') || undefined,
      weeks: entry.weeks,
      color: entry.color,
      source: 'crawl' as const
    }))
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
}

/* -------------------------------- 抓取逻辑 -------------------------------- */

export async function captureTimetable(): Promise<{
  ok: boolean
  slots: CourseSlot[]
  note: string
  candidates?: JsonCandidate[]
  week?: number
  termName?: string
  termStart?: string
  error?: string
}> {
  const win = getCampusWindow()
  if (!win) return { ok: false, slots: [], note: '', error: '抓取窗口已关闭，请重新点「打开登录窗口」' }

  if (!captured.length) {
    // 还没抓到任何接口响应时，先试着读一次页面表格
  }

  // 接口优先：按"像学生课表的程度"打分挑一个响应，避免混入校历/院系大课表
  let bestApi: { slots: CourseSlot[]; score: number; url: string } | null = null
  for (const item of captured.slice(-40)) {
    try {
      const parsed = JSON.parse(item.body)
      const slots = slotsFromJson(parsed)
      if (!slots.length) continue
      let score = slots.length
      // 学生个人课表接口权重最高
      if (/findStudentTimetab|studentTimetab|myTimetable/i.test(item.url)) score *= 4
      score += slots.filter((slot) => slot.teacher).length * 2
      score += slots.filter((slot) => slot.weeks).length * 2
      score += slots.filter((slot) => slot.location).length
      if (!bestApi || score > bestApi.score) bestApi = { slots, score, url: item.url }
    } catch {
      /* 非 JSON 忽略 */
    }
  }
  const fromApi: CourseSlot[] = bestApi ? bestApi.slots : []

  let fromDom: CourseSlot[] = []
  try {
    const result = (await win.webContents.executeJavaScript(DOM_EXTRACT, true)) as {
      cells: Array<{ weekday: number; raw: string; title?: string; periodText: string }>
      title: string
      url: string
    }
    fromDom = slotsFromCells(result.cells ?? [])
  } catch {
    /* 忽略 DOM 失败 */
  }

  const slots = fromApi.length ? mergeSlots(fromApi) : mergeSlots(fromDom)
  const parts: string[] = []
  if (fromApi.length) parts.push(`接口解析 ${fromApi.length} 门`)
  else if (fromDom.length) parts.push(`页面解析 ${fromDom.length} 门`)

  // 顺便读出"现在是第几周 / 哪个学期 / 开学日"（教务的校历接口里带）
  let week: number | undefined
  let termName: string | undefined
  let termStart: string | undefined
  for (const item of captured.slice(-40)) {
    try {
      const parsed = JSON.parse(item.body) as { data?: Record<string, unknown> }
      const data = parsed?.data
      if (!data || typeof data !== 'object') continue
      const weekValue = (data as Record<string, unknown>).week
      if (typeof weekValue === 'number') week = weekValue
      const simpleName = (data as Record<string, unknown>).simpleName
      if (typeof simpleName === 'string' && simpleName.length < 40) termName = simpleName
      // 校历里的 beginDay 是第 1 周的起始毫秒时间戳
      const calendar = (data as Record<string, unknown>).schoolCalendar as Record<string, unknown> | undefined
      const beginDay = (data as Record<string, unknown>).beginDay ?? calendar?.beginDay
      const begin = typeof beginDay === 'number' ? new Date(beginDay) : null
      if (begin && !Number.isNaN(begin.getTime())) {
        // 归一到"那一周的周一"
        const monday = new Date(begin)
        const offset = (monday.getDay() + 6) % 7
        monday.setDate(monday.getDate() - offset)
        termStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
      }
    } catch {
      /* 非 JSON */
    }
  }

  let candidates: JsonCandidate[] | undefined
  if (!slots.length) {
    const sources: Array<{ id: string; url: string; json: unknown }> = []
    for (const item of captured.slice(-40)) {
      try {
        sources.push({ id: item.id, url: item.url, json: JSON.parse(item.body) })
      } catch {
        /* 非 JSON */
      }
    }
    candidates = discoverCandidates(sources)
  }

  const note = slots.length
    ? `已识别 ${parts.join(' + ')}，同段合并后 ${slots.length} 条`
    : candidates?.length
      ? `没自动识别到课表，但抓到了 ${candidates.length} 组接口数据，可以手动指定字段`
      : '没抓到课表：请确认已在窗口里登录并打开「我的课表」页面后再点抓取；也可以手动录入、CSV 导入'

  return { ok: slots.length > 0, slots, note, candidates, week, termName, termStart }
}

/** 用户指定字段后重新提取（适配任意学校的接口结构） */
export function captureWithMapping(
  candidateId: string,
  mapping: TimetableMapping
): { ok: boolean; slots: CourseSlot[]; error?: string } {
  const [bodyId] = String(candidateId ?? '').split('#')
  const item = captured.find((entry) => entry.id === bodyId)
  if (!item) return { ok: false, slots: [], error: '这组接口数据已过期，请重新抓取一次' }
  try {
    const json = JSON.parse(item.body)
    const slots = mergeSlots(slotsWithMapping(json, mapping))
    return { ok: slots.length > 0, slots, error: slots.length ? undefined : '按这组字段没解析出课程，换一组字段试试' }
  } catch (error) {
    return { ok: false, slots: [], error: (error as Error).message }
  }
}


/** 抓取诊断：把捕获到的接口与解析结果打包，方便排查"抓得不对" */
export function timetableDiagnostics(): { ok: boolean; text: string; error?: string } {
  const win = getCampusWindow()
  const bodies = captured.slice(-8).map((item) => {
    let parsedSummary: unknown = null
    try {
      const slots = slotsFromJson(JSON.parse(item.body))
      parsedSummary = { slots: slots.length, sample: slots.slice(0, 3) }
    } catch {
      parsedSummary = 'not-json'
    }
    return {
      url: item.url,
      bytes: item.body.length,
      parsed: parsedSummary,
      preview: item.body.slice(0, 1500)
    }
  })
  const payload = {
    generatedAt: new Date().toISOString(),
    pageUrl: win ? win.webContents.getURL() : '',
    capturedCount: captured.length,
    bodies
  }
  return { ok: true, text: JSON.stringify(payload, null, 2) }
}
