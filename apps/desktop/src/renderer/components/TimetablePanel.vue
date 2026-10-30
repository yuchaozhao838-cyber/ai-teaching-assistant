<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { CourseSlot } from '@tutor/shared'
import {
  WEEKDAY_NAMES,
  courseColor,
  daysUntil,
  isDateKey,
  isVacationDay,
  isWeekActive,
  mondayOf,
  periodEnd,
  periodStart,
  toDateKey,
  weekDates,
  weekOfTerm,
  weekStartDate
} from '@tutor/study'
import Icon from './Icon.vue'
import {
  applyTimetableMapping,
  saveTimetableMetaPatch,
  saveTimetableWeek,
  captureTimetable,
  closeCrawler,
  exportTimetableDiagnostics,
  importTimetableCsv,
  openCrawler,
  saveCourseSlots,
  state
} from '../store'
import type { JsonCandidate } from '@tutor/shared'

const message = useMessage()

const crawlerUrl = ref(localStorage.getItem('campusUrl') || '')
const busy = ref(false)
const termName = computed(() => state.timetableMeta?.termName ?? '')
/** 当前周：有开学日就按日历自动推进，否则退回抓取到的周 */
const currentWeek = computed(() => {
  const meta = state.timetableMeta
  if (meta?.termStart) return weekOfTerm(meta.termStart, new Date(), meta.totalWeeks ?? 30)
  return meta?.week ?? 1
})
const todayKey = computed(() => toDateKey(new Date()))
const onVacation = computed(() => isVacationDay(todayKey.value, state.timetableMeta?.vacations))
const examWeekStart = computed(() => state.timetableMeta?.examWeekStart ?? 17)
const examWeekEnd = computed(() => state.timetableMeta?.examWeekEnd ?? 18)
const inExamWeek = computed(() => currentWeek.value >= examWeekStart.value && currentWeek.value <= examWeekEnd.value)
const examStartDate = computed(() => {
  const meta = state.timetableMeta
  if (!meta?.termStart) return ''
  return weekStartDate(meta.termStart, examWeekStart.value)
})
const daysToExam = computed(() => (examStartDate.value ? daysUntil(examStartDate.value) : null))
/** 当前查看的教学周；默认用抓到的"当前周" */
const selectedWeek = ref(state.timetableMeta?.viewWeek ?? state.timetableMeta?.week ?? 1)
const onlyThisWeek = ref(true)
/** 列表视图：卡片放不下的信息（教室/老师/周次）用表格一次看全 */
const listMode = ref(false)
const showUrl = ref(!crawlerUrl.value)

const allSlots = computed(() => state.courseSlots)
const slots = computed(() =>
  onlyThisWeek.value ? allSlots.value.filter((slot) => isWeekActive(slot.weeks, selectedWeek.value)) : allSlots.value
)
const slotsThisWeek = computed(() => allSlots.value.filter((slot) => isWeekActive(slot.weeks, selectedWeek.value)))

/** 选中周每天对应的日期（需要开学日） */
const dayDates = computed(() => {
  const termStart = state.timetableMeta?.termStart
  if (!termStart) return [] as string[]
  return weekDates(termStart, selectedWeek.value)
})

function changeWeek(delta: number) {
  const next = Math.max(1, Math.min(30, selectedWeek.value + delta))
  selectedWeek.value = next
  if (state.timetableMeta?.week !== next) void saveTimetableWeek(next)
}

function resetWeek() {
  const current = state.timetableMeta?.week ?? 1
  selectedWeek.value = current
  void saveTimetableWeek(current)
}

/** 抓取后：当前周与查看周都对齐到教务的当前周 */
function syncWeekFromCapture(week?: number) {
  if (!week) return
  selectedWeek.value = week
}

/** 时间轴：08:00 - 22:00 */
const START_HOUR = 8
const END_HOUR = 22
const HOUR_HEIGHT = 46

const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index)
const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return (Number.isFinite(hour) ? hour : 8) * 60 + (Number.isFinite(minute) ? minute : 0)
}

function topOf(slot: CourseSlot): number {
  const start = Math.max(minutesOf(slot.startTime), START_HOUR * 60)
  return ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT
}

function heightOf(slot: CourseSlot): number {
  const start = Math.max(minutesOf(slot.startTime), START_HOUR * 60)
  const end = Math.max(minutesOf(slot.endTime), start + 30)
  return Math.max(28, ((end - start) / 60) * HOUR_HEIGHT)
}

const byWeekday = computed(() => {
  const map = new Map<number, CourseSlot[]>()
  for (const slot of slots.value) {
    const list = map.get(slot.weekday) ?? []
    list.push(slot)
    map.set(slot.weekday, list)
  }
  return map
})

const todayWeekday = computed(() => ((new Date().getDay() + 6) % 7) + 1)

/** 同一天里时间重叠的课并排显示，避免卡片互相盖住 */
const dayLayout = computed(() => {
  const map = new Map<number, Array<{ slot: CourseSlot; lane: number; lanes: number }>>()
  for (let day = 1; day <= 7; day += 1) {
    const list = [...(byWeekday.value.get(day) ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
    const laneEnds: number[] = []
    const items = list.map((slot) => {
      const start = minutesOf(slot.startTime)
      const end = minutesOf(slot.endTime)
      let lane = laneEnds.findIndex((value) => value <= start)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(end)
      } else {
        laneEnds[lane] = Math.max(laneEnds[lane], end)
      }
      return { slot, lane, lanes: 1 }
    })
    for (const item of items) item.lanes = laneEnds.length
    map.set(day, items)
  }
  return map
})

function rememberUrl() {
  const url = crawlerUrl.value.trim()
  if (url) localStorage.setItem('campusUrl', url)
}

async function onOpenCrawler() {
  const url = crawlerUrl.value.trim()
  if (!url) {
    showUrl.value = true
    message.warning('先填你学校的教务系统地址（学校官网 → 教务处 → 教务系统）')
    return
  }
  rememberUrl()
  busy.value = true
  try {
    const result = await openCrawler(url)
    if (!result.ok) {
      message.error(result.error ?? '打开登录窗口失败')
      return
    }
    message.info('在弹出的窗口里登录并打开「我的课表」，然后回来点「抓取课表」', { duration: 8000 })
  } finally {
    busy.value = false
  }
}

async function onDiagnostics() {
  const result = await exportTimetableDiagnostics()
  if (result.ok) {
    message.success('已导出「课表抓取诊断.json」，发给我就能照着真实结构修解析', { duration: 8000 })
  } else {
    message.warning('还没有可导出的抓取数据，先点一次「抓取课表」')
  }
}

async function onCapture() {
  busy.value = true
  try {
    const result = await captureTimetable()
    if (result.ok) {
      syncWeekFromCapture(result.week)
      message.success(result.note || `已抓取 ${result.slots.length} 节课`, { duration: 6000 })
      await closeCrawler()
      return
    }
    message.warning(result.note || result.error || '没有抓到课表', { duration: 9000 })
    if (result.candidates?.length) {
      candidates.value = result.candidates
      pickCandidate(result.candidates[0])
    }
  } finally {
    busy.value = false
  }
}

/* -------------------------------- 手动添加 -------------------------------- */
const addOpen = ref(false)
const draft = ref({
  courseName: '',
  weekday: 1 as CourseSlot['weekday'],
  startTime: '08:00',
  endTime: '09:35',
  location: '',
  teacher: '',
  weeks: ''
})

function openAdd() {
  draft.value = { courseName: '', weekday: todayWeekday.value as CourseSlot['weekday'], startTime: '08:00', endTime: '09:35', location: '', teacher: '', weeks: '' }
  addOpen.value = true
}

async function submitAdd() {
  if (!draft.value.courseName.trim()) {
    message.warning('填一下课程名')
    return
  }
  const slot: CourseSlot = {
    id: `slot_${Date.now().toString(36)}`,
    courseName: draft.value.courseName.trim(),
    weekday: draft.value.weekday,
    startTime: draft.value.startTime || '08:00',
    endTime: draft.value.endTime || '09:35',
    location: draft.value.location.trim() || undefined,
    teacher: draft.value.teacher.trim() || undefined,
    weeks: draft.value.weeks.trim() || undefined,
    color: courseColor(draft.value.courseName.trim()),
    source: 'manual'
  }
  await saveCourseSlots([...slots.value, slot])
  addOpen.value = false
  message.success('已添加')
}

async function removeSlot(slot: CourseSlot) {
  await saveCourseSlots(slots.value.filter((item) => item.id !== slot.id))
}

async function clearAll() {
  await saveCourseSlots([])
  message.success('课表已清空')
}

/* ------------------------------- 教学周设置 ------------------------------- */
const termOpen = ref(false)
const termDraft = ref({
  termName: '',
  termStart: mondayOf(toDateKey(new Date())),
  totalWeeks: 18,
  examWeekStart: 17,
  examWeekEnd: 18,
  vacations: [] as Array<{ start: string | null; end: string | null; name?: string }>
})

function openTerm() {
  const meta = state.timetableMeta
  termDraft.value = {
    termName: meta?.termName ?? '',
    termStart: isDateKey(meta?.termStart) ? (meta?.termStart as string) : mondayOf(toDateKey(new Date())),
    totalWeeks: meta?.totalWeeks ?? 18,
    examWeekStart: meta?.examWeekStart ?? 17,
    examWeekEnd: meta?.examWeekEnd ?? 18,
    vacations: (meta?.vacations ?? [])
      .filter((item) => isDateKey(item.start) && isDateKey(item.end))
      .map((item) => ({ start: item.start, end: item.end, name: item.name }))
  }
  termOpen.value = true
}

function addVacation() {
  const today = toDateKey(new Date())
  termDraft.value.vacations.push({ start: today, end: today, name: '' })
}

function removeVacation(index: number) {
  termDraft.value.vacations.splice(index, 1)
}

async function saveTerm() {
  const draft = termDraft.value
  if (!isDateKey(draft.termStart)) {
    message.warning('请先选择「第 1 周周一」的日期')
    return
  }
  const badVacation = draft.vacations.find((item) => !isDateKey(item.start ?? '') || !isDateKey(item.end ?? ''))
  if (badVacation) {
    message.warning('放假区间要选完整的开始和结束日期（不需要就删掉这一行）')
    return
  }
  await saveTimetableMetaPatch({
    termName: draft.termName || undefined,
    termStart: mondayOf(draft.termStart),
    totalWeeks: Math.min(30, Math.max(1, Number(draft.totalWeeks) || 18)),
    examWeekStart: Math.min(30, Math.max(1, Number(draft.examWeekStart) || 17)),
    examWeekEnd: Math.min(30, Math.max(1, Number(draft.examWeekEnd) || 18)),
    vacations: draft.vacations
      .filter((item) => isDateKey(item.start ?? '') && isDateKey(item.end ?? ''))
      .map((item) => ({ start: item.start as string, end: item.end as string, name: item.name }))
  })
  selectedWeek.value = currentWeek.value
  termOpen.value = false
  message.success('教学周设置已保存')
}

/* ------------------------------ 字段映射（多学校） ------------------------------ */
const candidates = ref<JsonCandidate[]>([])
const mapping = ref({
  nameKey: '',
  weekdayKey: '',
  startKey: '',
  endKey: '',
  locationKey: '',
  teacherKey: ''
})
const mappingBusy = ref(false)

const currentCandidate = computed(() => candidates.value.find((item) => item.id === mappingCandidateId.value))
const mappingCandidateId = ref('')

function guessKey(keys: string[], patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const hit = keys.find((key) => pattern.test(key))
    if (hit) return hit
  }
  return ''
}

function pickCandidate(candidate: JsonCandidate) {
  mappingCandidateId.value = candidate.id
  mapping.value = {
    nameKey: guessKey(candidate.keys, [/coursename/i, /kcmc/i, /^name$/i, /title/i, /course/i]),
    weekdayKey: guessKey(candidate.keys, [/weekday/i, /xqj/i, /weekdayname/i, /^day$/i, /week/i]),
    startKey: guessKey(candidate.keys, [/starttime/i, /qsj/i, /start/i, /begin/i, /kssj/i]),
    endKey: guessKey(candidate.keys, [/endtime/i, /jssj/i, /end$/i, /finish/i]),
    locationKey: guessKey(candidate.keys, [/location/i, /cdmc/i, /room/i, /place/i, /classroom/i]),
    teacherKey: guessKey(candidate.keys, [/teacher/i, /skjs/i, /instructor/i])
  }
}

function keyOptions(candidate: JsonCandidate | undefined) {
  if (!candidate) return []
  return candidate.keys.map((key) => ({ label: `${key}${candidate.sample[key] ? `（${candidate.sample[key]}）` : ''}`, value: key }))
}

async function applyMapping() {
  if (!mappingCandidateId.value) return
  if (!mapping.value.nameKey || !mapping.value.weekdayKey) {
    message.warning('至少要指定「课程名」和「星期」两个字段')
    return
  }
  mappingBusy.value = true
  try {
    const result = await applyTimetableMapping(mappingCandidateId.value, {
      nameKey: mapping.value.nameKey,
      weekdayKey: mapping.value.weekdayKey,
      startKey: mapping.value.startKey || undefined,
      endKey: mapping.value.endKey || undefined,
      locationKey: mapping.value.locationKey || undefined,
      teacherKey: mapping.value.teacherKey || undefined
    })
    if (result.ok) {
      message.success(`按字段解析出 ${result.slots.length} 节课，已保存`)
      candidates.value = []
    } else {
      message.warning(result.error ?? '没解析出课程，换一组字段试试', { duration: 8000 })
    }
  } finally {
    mappingBusy.value = false
  }
}

/* -------------------------------- CSV 导入 -------------------------------- */
const fileInput = ref<HTMLInputElement | null>(null)

async function onCsvChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const result = await importTimetableCsv(text)
  if (result.ok) {
    await saveCourseSlots([...slots.value.filter((slot) => slot.source !== 'import'), ...result.slots])
    message.success(`导入 ${result.slots.length} 节课${result.errors.length ? `，${result.errors.length} 行有问题` : ''}`)
    for (const error of result.errors.slice(0, 3)) message.warning(error, { duration: 8000 })
  } else {
    message.error(result.errors.join('；') || 'CSV 解析失败')
  }
  input.value = ''
}
</script>

<template>
  <div class="timetable-panel">
    <div class="tt-toolbar">
      <div class="tt-actions">
        <n-button size="small" type="primary" :loading="busy" @click="onOpenCrawler">
          <template #icon><Icon name="globe" :size="13" /></template>
          登录教务系统抓取
        </n-button>
        <n-button size="small" :loading="busy" @click="onCapture">抓取课表</n-button>
        <n-button size="small" quaternary @click="showUrl = !showUrl">网址</n-button>
        <n-button size="small" quaternary @click="openAdd">
          <template #icon><Icon name="plus" :size="13" /></template>
          手动添加
        </n-button>
        <n-button size="small" quaternary @click="fileInput?.click()">导入 CSV</n-button>
        <n-button size="small" quaternary @click="listMode = !listMode">{{ listMode ? '卡片视图' : '列表视图' }}</n-button>
        <n-button v-if="slots.length" size="small" quaternary type="error" @click="clearAll">清空</n-button>
        <n-button size="small" quaternary @click="onDiagnostics">导出诊断</n-button>
      </div>
      <span class="tt-count">
        <template v-if="termName">{{ termName }} · </template>{{ slotsThisWeek.length }} 节课
      </span>
    </div>

    <div class="week-bar">
      <n-button size="tiny" quaternary @click="changeWeek(-1)">‹</n-button>
      <span class="week-label">
        第 {{ selectedWeek }} 周
        <template v-if="currentWeek && currentWeek === selectedWeek">（本周）</template>
      </span>
      <n-button size="tiny" quaternary @click="changeWeek(1)">›</n-button>
      <n-button size="tiny" quaternary @click="resetWeek">回到本周</n-button>
      <n-checkbox v-model:checked="onlyThisWeek" size="small">只看这一周</n-checkbox>
      <n-button size="tiny" quaternary @click="openTerm">教学周设置</n-button>
      <span v-if="onVacation" class="week-badge vacation">放假中</span>
      <span v-else-if="inExamWeek" class="week-badge exam">考试周</span>
      <span v-if="daysToExam !== null && daysToExam > 0" class="week-badge countdown">距期末 {{ daysToExam }} 天</span>
      <span v-if="dayDates.length" class="week-dates">{{ dayDates[0].slice(5) }} ~ {{ dayDates[6].slice(5) }}</span>
      <span v-else class="week-hint">（抓取一次可自动获得开学日期与当前周）</span>
    </div>

    <div v-if="showUrl" class="tt-url-row">
      <n-input
        v-model:value="crawlerUrl"
        size="small"
        placeholder="你学校的教务系统地址，例如 https://jw.xxx.edu.cn/"
        @keyup.enter="onOpenCrawler"
      />
      <span class="tt-hint">在弹出窗口里登录 → 打开「我的课表」→ 回来点「抓取课表」</span>
    </div>

    <div v-if="candidates.length" class="mapping-card">
      <div class="mapping-title">自动识别没成功，但抓到了接口数据 —— 指定一下字段就能解析</div>
      <div class="mapping-row">
        <span class="mapping-label">接口</span>
        <n-select
          size="small"
          style="flex: 1; min-width: 220px"
          :value="mappingCandidateId"
          :options="candidates.map((item) => ({ label: `${item.url.split('/').pop() || item.url} · ${item.count} 条`, value: item.id }))"
          @update:value="(value: string) => pickCandidate(candidates.find((item) => item.id === value)!)"
        />
      </div>
      <div class="mapping-grid">
        <div class="mapping-field">
          <span>课程名 *</span>
          <n-select v-model:value="mapping.nameKey" size="small" :options="keyOptions(currentCandidate)" filterable />
        </div>
        <div class="mapping-field">
          <span>星期 *</span>
          <n-select v-model:value="mapping.weekdayKey" size="small" :options="keyOptions(currentCandidate)" filterable />
        </div>
        <div class="mapping-field">
          <span>开始时间</span>
          <n-select v-model:value="mapping.startKey" size="small" :options="keyOptions(currentCandidate)" clearable filterable />
        </div>
        <div class="mapping-field">
          <span>结束时间</span>
          <n-select v-model:value="mapping.endKey" size="small" :options="keyOptions(currentCandidate)" clearable filterable />
        </div>
        <div class="mapping-field">
          <span>地点</span>
          <n-select v-model:value="mapping.locationKey" size="small" :options="keyOptions(currentCandidate)" clearable filterable />
        </div>
        <div class="mapping-field">
          <span>老师</span>
          <n-select v-model:value="mapping.teacherKey" size="small" :options="keyOptions(currentCandidate)" clearable filterable />
        </div>
      </div>
      <div class="mapping-actions">
        <n-button size="small" type="primary" :loading="mappingBusy" @click="applyMapping">按这些字段解析</n-button>
        <n-button size="small" quaternary @click="candidates = []">忽略</n-button>
      </div>
    </div>

    <div v-if="!allSlots.length" class="tt-empty">
      <div class="tt-empty-title">还没有课表</div>
      <p>
        ① 先把「网址」改成**你自己学校**的教务系统地址（学校官网 → 教务处/本科生院 → 教务系统），
        点「登录教务系统抓取」，在弹出的窗口里登录并打开课表页，回来点「抓取课表」；<br />
        ② 抓不到会自动列出接口数据，指定「课程名 / 星期」等字段即可解析（任何学校都适用）；<br />
        ③ 还不行就手动添加，或导入 CSV（表头：课程,星期,开始,结束,地点,老师,周次）。
      </p>
      <div class="tt-actions" style="justify-content: center">
        <n-button size="small" type="primary" @click="onOpenCrawler">登录教务系统</n-button>
        <n-button size="small" @click="openAdd">手动添加</n-button>
        <n-button size="small" quaternary @click="fileInput?.click()">导入 CSV</n-button>
      </div>
      <div class="tt-help">
        <b>怎么找我学校的地址？</b>学校官网 → 教务处 / 本科生院 / 研究生院 → 「教务系统」或「学生服务」→ 登录页地址就是它。
        常见系统：正方（`*.zfsoft.com` 或 `jw.xxx.edu.cn`）、青果、强智、超星/学习通课表。
        登录后请打开「我的课表 / 课表查询」页面再回来点抓取。
      </div>
    </div>

    <div v-else-if="!slots.length" class="tt-empty" style="border-style: solid">
      <div class="tt-empty-title">第 {{ selectedWeek }} 周没有课</div>
      <p>可能是这周没排课，或者这门课不带周次信息。取消勾选「只看这一周」可以看到全部课程。</p>
      <n-button size="small" @click="onlyThisWeek = false">显示全部课程</n-button>
    </div>

    <div v-else-if="listMode" class="tt-list-wrap">
      <table class="tt-table">
        <thead>
          <tr>
            <th>课程</th>
            <th>星期</th>
            <th>时间</th>
            <th>教室</th>
            <th>老师</th>
            <th>周次</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in slots" :key="item.id">
            <td class="tt-course">
              <span class="tt-dot" :style="{ background: item.color || '#2f4bd8' }" />
              {{ item.courseName }}
            </td>
            <td>周{{ WEEKDAY_NAMES[item.weekday - 1] }}</td>
            <td>{{ item.startTime }}-{{ item.endTime }}</td>
            <td class="tt-room">{{ item.location || '—' }}</td>
            <td>{{ item.teacher || '—' }}</td>
            <td>{{ item.weeks ? `${item.weeks} 周` : '每周' }}</td>
            <td><button class="event-del" @click="removeSlot(item)">×</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="tt-grid-wrap">
      <div class="tt-hours">
        <div v-for="hour in hours" :key="hour" class="tt-hour" :style="{ height: `${HOUR_HEIGHT}px` }">
          {{ String(hour).padStart(2, '0') }}:00
        </div>
      </div>
      <div class="tt-days">
        <div v-for="weekday in 7" :key="weekday" class="tt-day" :class="{ today: weekday === todayWeekday }">
          <div class="tt-day-head">
            周{{ WEEKDAY_NAMES[weekday - 1] }}
            <span v-if="dayDates.length" class="day-date">{{ dayDates[weekday - 1].slice(5) }}</span>
          </div>
          <div class="tt-day-body" :style="{ height: `${gridHeight}px` }">
            <div
              v-for="item in dayLayout.get(weekday) ?? []"
              :key="item.slot.id"
              class="course-card"
              :style="{
                top: `${topOf(item.slot)}px`,
                height: `${heightOf(item.slot)}px`,
                left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`,
                width: `calc(${100 / item.lanes}% - 4px)`,
                borderLeftColor: item.slot.color || '#2f4bd8',
                background: `${item.slot.color || '#2f4bd8'}12`
              }"
              :title="`${item.slot.courseName} ${item.slot.startTime}-${item.slot.endTime} ${item.slot.location ?? ''} ${item.slot.teacher ?? ''}`"
            >
              <div class="course-name">{{ item.slot.courseName }}</div>
              <div v-if="item.slot.location" class="course-meta course-room">{{ item.slot.location }}</div>
              <div class="course-meta">{{ item.slot.startTime }}-{{ item.slot.endTime }}</div>
              <div v-if="item.slot.teacher" class="course-meta">{{ item.slot.teacher }}</div>
              <div v-if="item.slot.weeks" class="course-meta course-weeks">{{ item.slot.weeks }} 周</div>
              <button class="course-del" @click.stop="removeSlot(item.slot)">×</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".csv,text/csv" style="display: none" @change="onCsvChange" />

    <!-- 教学周设置 -->
    <n-modal v-model:show="termOpen" preset="card" title="教学周设置" :bordered="false" style="width: 620px">
      <n-form label-placement="top" :show-feedback="false">
        <div class="form-row">
          <n-form-item label="学期名称（可留空）" style="flex: 2">
            <n-input v-model:value="termDraft.termName" placeholder="2026-2027学年度第1学期" />
          </n-form-item>
          <n-form-item label="总周数" style="flex: 1">
            <n-input-number v-model:value="termDraft.totalWeeks" :min="1" :max="30" style="width: 100%" />
          </n-form-item>
        </div>
        <n-form-item label="第 1 周周一（开学日；周数按这个日期自动推进）">
          <n-date-picker
            v-model:formatted-value="termDraft.termStart"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            style="width: 100%"
          />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="考试周开始" style="flex: 1">
            <n-input-number v-model:value="termDraft.examWeekStart" :min="1" :max="30" style="width: 100%" />
          </n-form-item>
          <n-form-item label="考试周结束" style="flex: 1">
            <n-input-number v-model:value="termDraft.examWeekEnd" :min="1" :max="30" style="width: 100%" />
          </n-form-item>
          <n-form-item label="当前是" style="flex: 1">
            <n-input :value="`第 ${currentWeek} 周`" disabled />
          </n-form-item>
        </div>
      </n-form>

      <div class="vacation-head">
        <span>放假区间（这些天不算上课周，首页显示「放假中」）</span>
        <n-button size="tiny" quaternary @click="addVacation">+ 添加</n-button>
      </div>
      <div v-for="(vacation, index) in termDraft.vacations" :key="index" class="vacation-row">
        <n-input v-model:value="vacation.name" size="small" placeholder="名称（如 国庆）" style="width: 120px" />
        <n-date-picker v-model:formatted-value="vacation.start" type="date" value-format="yyyy-MM-dd" size="small" style="width: 150px" />
        <span class="vacation-sep">~</span>
        <n-date-picker v-model:formatted-value="vacation.end" type="date" value-format="yyyy-MM-dd" size="small" style="width: 150px" />
        <n-button size="tiny" quaternary type="error" @click="removeVacation(index)">删</n-button>
      </div>
      <p class="term-tip">
        周数按「今天 − 第 1 周周一」自动推进，不用每周手改；放假期间首页显示「放假中」，考试周显示「考试周」。
      </p>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="termOpen = false">取消</n-button>
          <n-button type="primary" @click="saveTerm">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="addOpen" preset="card" title="手动添加课程" :bordered="false" style="width: 560px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="课程名">
          <n-input v-model:value="draft.courseName" placeholder="例如：高等数学（A）" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="星期" style="flex: 1">
            <n-select
              v-model:value="draft.weekday"
              :options="WEEKDAY_NAMES.map((name, index) => ({ label: `周${name}`, value: index + 1 }))"
            />
          </n-form-item>
          <n-form-item label="开始" style="flex: 1">
            <n-input v-model:value="draft.startTime" placeholder="08:00" />
          </n-form-item>
          <n-form-item label="结束" style="flex: 1">
            <n-input v-model:value="draft.endTime" placeholder="09:35" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="地点" style="flex: 1">
            <n-input v-model:value="draft.location" placeholder="教学楼 A301" />
          </n-form-item>
          <n-form-item label="老师" style="flex: 1">
            <n-input v-model:value="draft.teacher" placeholder="可选" />
          </n-form-item>
        </div>
        <n-form-item label="周次">
          <n-input v-model:value="draft.weeks" placeholder="例如：1-16 周 / 单周" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="addOpen = false">取消</n-button>
          <n-button type="primary" @click="submitAdd">添加</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.timetable-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tt-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tt-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.week-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #f7f9fd;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 6px 10px;
}

.week-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}

.week-badge {
  font-size: 10.5px;
  border-radius: 6px;
  padding: 1px 7px;
}
.week-badge.vacation {
  background: #e8f7f1;
  color: #1f9d76;
}
.week-badge.exam {
  background: #fdf2f2;
  color: #c53030;
}
.week-badge.countdown {
  background: #eef2ff;
  color: #2f4bd8;
}
.vacation-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
  margin: 6px 0 8px;
}
.vacation-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.vacation-sep {
  color: var(--text-faint);
}
.term-tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
}
.week-dates {
  font-size: 11.5px;
  color: var(--primary);
  background: #eef2ff;
  border-radius: 6px;
  padding: 1px 8px;
}

.week-hint {
  font-size: 11px;
  color: var(--text-faint);
}

.day-date {
  font-size: 9.5px;
  color: var(--text-faint);
  margin-left: 2px;
}

.tt-count {
  font-size: 11.5px;
  color: var(--text-faint);
}
.tt-url-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.tt-hint {
  font-size: 11px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.mapping-card {
  background: #fdfbff;
  border: 1px solid #e6def7;
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mapping-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #6d28d9;
}

.mapping-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mapping-label {
  font-size: 11.5px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.mapping-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}

.mapping-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.mapping-actions {
  display: flex;
  gap: 8px;
}

.tt-empty {
  background: #fff;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  padding: 28px 20px;
  text-align: center;
}
.tt-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 6px;
}
.tt-help {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-soft);
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.75;
  text-align: left;
}

.tt-empty p {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.8;
  margin: 0 0 14px;
}
.tt-list-wrap {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 6px 10px 10px;
  overflow-x: auto;
}

.tt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.tt-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-muted);
  font-size: 11px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-soft);
  white-space: nowrap;
}

.tt-table td {
  padding: 6px 8px;
  border-bottom: 1px dashed var(--border-soft);
  color: var(--text-regular);
  vertical-align: middle;
}

.tt-course {
  color: var(--text-strong);
  font-weight: 600;
}

.tt-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
}

.tt-room {
  color: var(--text-strong);
}

.tt-grid-wrap {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 10px;
  overflow-x: auto;
}
.tt-hours {
  padding-top: 24px;
}
.tt-hour {
  font-size: 10.5px;
  color: var(--text-faint);
  border-top: 1px dashed var(--border-soft);
  padding-top: 2px;
  box-sizing: border-box;
}
.tt-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(96px, 1fr));
  gap: 4px;
}
.tt-day {
  display: flex;
  flex-direction: column;
  min-width: 96px;
}
.tt-day-head {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  height: 22px;
  line-height: 22px;
  background: #f7f9fd;
  border-radius: 6px;
  margin-bottom: 2px;
}
.tt-day.today .tt-day-head {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}
.tt-day-body {
  position: relative;
  border-left: 1px solid var(--border-soft);
}
.course-card {
  position: absolute;
  border-radius: 6px;
  border-left: 3px solid #2f4bd8;
  padding: 3px 5px;
  overflow: hidden;
  font-size: 10.5px;
  line-height: 1.35;
  cursor: default;
}
.course-name {
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}
.course-weeks {
  color: #6d28d9;
}

.course-meta {
  color: var(--text-muted);
  font-size: 9.5px;
  line-height: 1.3;
  overflow: hidden;
  word-break: break-all;
}

.course-room {
  color: var(--text-strong);
  font-weight: 600;
  font-size: 10px;
}
.course-del {
  position: absolute;
  right: 1px;
  top: 0;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px;
}
.form-row {
  display: flex;
  gap: 12px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 860px) {
  .tt-days {
    grid-template-columns: repeat(7, minmax(84px, 1fr));
  }
}
</style>
